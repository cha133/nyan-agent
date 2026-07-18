import { useEffect } from "react";
import { $getRoot, type EditorState } from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

type PromptEditorProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
};

function EditableState({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return null;
}

export function PromptEditor({ disabled = false, onChange }: PromptEditorProps) {
  return (
    <LexicalComposer initialConfig={{
      namespace: "nyan-prompt",
      editable: !disabled,
      onError(error) { throw error; },
    }}>
      <div className="prompt-editor">
        <PlainTextPlugin
          contentEditable={<ContentEditable className="prompt-input" aria-label="给 nyan 发送消息" />}
          placeholder={<span className="prompt-placeholder">让 nyan 帮你完成一个任务…</span>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={(state: EditorState) => state.read(() => onChange($getRoot().getTextContent()))} />
        <EditableState disabled={disabled} />
      </div>
    </LexicalComposer>
  );
}
