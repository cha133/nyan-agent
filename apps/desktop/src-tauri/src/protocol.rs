use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const PROTOCOL_VERSION: u8 = 1;

macro_rules! domain_id {
    ($name:ident) => {
        #[allow(dead_code)]
        #[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        #[allow(dead_code)]
        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }
    };
}

domain_id!(RequestId);
domain_id!(ProjectId);
domain_id!(SessionId);
domain_id!(TurnId);
domain_id!(ToolExecutionId);
domain_id!(SubagentId);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum ClientMessage {
    #[serde(rename = "initialize", rename_all = "camelCase")]
    Initialize {
        v: u8,
        request_id: RequestId,
        client: ClientInfo,
    },
    #[serde(rename = "shutdown", rename_all = "camelCase")]
    Shutdown { v: u8, request_id: RequestId },
    #[serde(rename = "project.list", rename_all = "camelCase")]
    ProjectList { v: u8, request_id: RequestId },
    #[serde(rename = "project.add", rename_all = "camelCase")]
    ProjectAdd {
        v: u8,
        request_id: RequestId,
        path: String,
    },
    #[serde(rename = "project.remove", rename_all = "camelCase")]
    ProjectRemove {
        v: u8,
        request_id: RequestId,
        project_id: ProjectId,
    },
    #[serde(rename = "project.context.set", rename_all = "camelCase")]
    ProjectContextSet {
        v: u8,
        request_id: RequestId,
        project_id: Option<ProjectId>,
    },
    #[serde(rename = "model.list", rename_all = "camelCase")]
    ModelList {
        v: u8,
        request_id: RequestId,
        #[serde(skip_serializing_if = "Option::is_none")]
        refresh: Option<bool>,
    },
    #[serde(rename = "session.list", rename_all = "camelCase")]
    SessionList { v: u8, request_id: RequestId },
    #[serde(rename = "session.create", rename_all = "camelCase")]
    SessionCreate {
        v: u8,
        request_id: RequestId,
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<ProjectId>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    #[serde(rename = "session.load", rename_all = "camelCase")]
    SessionLoad {
        v: u8,
        request_id: RequestId,
        session_id: SessionId,
    },
    #[serde(rename = "session.model.set", rename_all = "camelCase")]
    SessionModelSet {
        v: u8,
        request_id: RequestId,
        session_id: SessionId,
        model: String,
    },
    #[serde(rename = "session.remove", rename_all = "camelCase")]
    SessionRemove {
        v: u8,
        request_id: RequestId,
        session_id: SessionId,
    },
    #[serde(rename = "prompt.submit", rename_all = "camelCase")]
    PromptSubmit {
        v: u8,
        request_id: RequestId,
        session_id: SessionId,
        prompt: String,
    },
    #[serde(rename = "turn.cancel", rename_all = "camelCase")]
    TurnCancel {
        v: u8,
        request_id: RequestId,
        session_id: SessionId,
        turn_id: TurnId,
    },
}

#[derive(Debug, Deserialize)]
pub struct ServerEnvelope {
    pub v: u8,
    #[serde(rename = "type")]
    pub message_type: String,
    #[serde(rename = "requestId")]
    pub request_id: Option<RequestId>,
    #[serde(flatten)]
    #[allow(dead_code)]
    pub payload: serde_json::Map<String, Value>,
}

impl ServerEnvelope {
    pub fn is_known_type(&self) -> bool {
        matches!(
            self.message_type.as_str(),
            "initialized"
                | "response"
                | "backend.error"
                | "backend.crashed"
                | "session.title.updated"
                | "turn.started"
                | "assistant.text.delta"
                | "assistant.block.completed"
                | "reasoning.delta"
                | "tool.started"
                | "tool.output"
                | "tool.completed"
                | "subagent.activity"
                | "turn.completed"
                | "turn.failed"
                | "turn.cancelled"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_deserializes_shared_golden_fixtures() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/fixtures/protocol-v1.json"
        ))
        .unwrap();
        let clients = fixture["clientMessages"].as_array().unwrap();
        let servers = fixture["serverMessages"].as_array().unwrap();

        for message in clients {
            let parsed: ClientMessage = serde_json::from_value(message.clone()).unwrap();
            let serialized = serde_json::to_value(parsed).unwrap();
            assert_eq!(serialized, *message);
        }

        for message in servers {
            let parsed: ServerEnvelope = serde_json::from_value(message.clone()).unwrap();
            assert_eq!(parsed.v, PROTOCOL_VERSION);
            assert!(!parsed.message_type.is_empty());
        }
    }

    #[test]
    fn generated_domain_ids_are_uuid_v4() {
        assert_eq!(RequestId::new().0.get_version_num(), 4);
        assert_eq!(ProjectId::new().0.get_version_num(), 4);
        assert_eq!(SessionId::new().0.get_version_num(), 4);
        assert_eq!(TurnId::new().0.get_version_num(), 4);
        assert_eq!(ToolExecutionId::new().0.get_version_num(), 4);
        assert_eq!(SubagentId::new().0.get_version_num(), 4);
    }
}
