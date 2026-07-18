use serde_json::Value;
use std::{error::Error, fmt};

pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Eq, PartialEq)]
pub enum NdjsonError {
    FrameTooLarge { limit: usize },
    InvalidUtf8,
    InvalidJson,
    UnexpectedEof { trailing_bytes: usize },
}

impl fmt::Display for NdjsonError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FrameTooLarge { limit } => {
                write!(formatter, "frame_too_large: frame exceeds {limit} bytes")
            }
            Self::InvalidUtf8 => formatter.write_str("invalid_utf8: frame is not valid UTF-8"),
            Self::InvalidJson => formatter.write_str("invalid_json: frame is not valid JSON"),
            Self::UnexpectedEof { trailing_bytes } => write!(
                formatter,
                "unexpected_eof: stream ended with {trailing_bytes} trailing bytes"
            ),
        }
    }
}

impl Error for NdjsonError {}

pub struct NdjsonDecoder {
    buffer: Vec<u8>,
    max_frame_bytes: usize,
}

impl Default for NdjsonDecoder {
    fn default() -> Self {
        Self::new(MAX_FRAME_BYTES)
    }
}

impl NdjsonDecoder {
    pub fn new(max_frame_bytes: usize) -> Self {
        Self {
            buffer: Vec::new(),
            max_frame_bytes,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, NdjsonError> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        let mut frame_start = 0;

        for index in 0..self.buffer.len() {
            if self.buffer[index] != b'\n' {
                continue;
            }
            let mut frame_end = index;
            if frame_end > frame_start && self.buffer[frame_end - 1] == b'\r' {
                frame_end -= 1;
            }
            let frame = &self.buffer[frame_start..frame_end];
            if frame.len() > self.max_frame_bytes {
                return Err(NdjsonError::FrameTooLarge {
                    limit: self.max_frame_bytes,
                });
            }
            if !frame.is_empty() {
                let text = std::str::from_utf8(frame).map_err(|_| NdjsonError::InvalidUtf8)?;
                messages.push(serde_json::from_str(text).map_err(|_| NdjsonError::InvalidJson)?);
            }
            frame_start = index + 1;
        }

        self.buffer.drain(..frame_start);
        if self.buffer.len() > self.max_frame_bytes {
            return Err(NdjsonError::FrameTooLarge {
                limit: self.max_frame_bytes,
            });
        }
        Ok(messages)
    }

    pub fn finish(&self) -> Result<(), NdjsonError> {
        if self.buffer.is_empty() {
            Ok(())
        } else {
            Err(NdjsonError::UnexpectedEof {
                trailing_bytes: self.buffer.len(),
            })
        }
    }
}

pub fn encode(value: &Value) -> Result<Vec<u8>, serde_json::Error> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_partial_multi_crlf_empty_and_split_utf8() {
        let encoded = encode(&serde_json::json!({ "text": "猫" })).unwrap();
        let split = encoded.iter().position(|byte| *byte == 0xe7).unwrap() + 1;
        let mut decoder = NdjsonDecoder::default();
        assert!(decoder.push(&encoded[..split]).unwrap().is_empty());
        let mut tail = encoded[split..].to_vec();
        tail.extend_from_slice(b"\r\n\n{\"n\":2}\n");
        let values = decoder.push(&tail).unwrap();
        assert_eq!(
            values,
            vec![
                serde_json::json!({ "text": "猫" }),
                serde_json::json!({ "n": 2 })
            ]
        );
        decoder.finish().unwrap();
    }

    #[test]
    fn enforces_limit_and_reports_trailing_bytes() {
        let mut limited = NdjsonDecoder::new(8);
        assert_eq!(
            limited.push(b"{\"long\":1}\n"),
            Err(NdjsonError::FrameTooLarge { limit: 8 })
        );

        let mut partial = NdjsonDecoder::default();
        partial.push(b"{\"partial\":true}").unwrap();
        assert_eq!(
            partial.finish(),
            Err(NdjsonError::UnexpectedEof { trailing_bytes: 16 })
        );
    }

    #[test]
    fn uses_the_production_sixteen_mibibyte_limit() {
        let mut decoder = NdjsonDecoder::default();
        let oversized = vec![b' '; MAX_FRAME_BYTES + 1];
        assert_eq!(
            decoder.push(&oversized),
            Err(NdjsonError::FrameTooLarge {
                limit: MAX_FRAME_BYTES
            })
        );
    }
}
