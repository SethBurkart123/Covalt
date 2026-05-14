
import { useCallback } from "react";
import Editor from "@monaco-editor/react";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { Loader2 } from "lucide-react";
import { ArtifactFileEditorFrame } from "@/components/ArtifactFileEditorFrame";
import { useArtifactFileEditorState } from "@/hooks/use-artifact-file-editor-state";

interface EditableCodeViewerProps {
  language: string;
  filePath?: string;
  content?: string;
  readOnly?: boolean;
}

export function EditableCodeViewer({
  language,
  filePath,
  content,
  readOnly = false,
}: EditableCodeViewerProps) {
  const resolvedTheme = useResolvedTheme();
  const isContentMode = !filePath && content !== undefined;
  const {
    currentContent,
    syncedContent,
    isLoading,
    isDeleted,
    effectiveReadOnly,
    saveStatus,
    errorMessage,
    isDesynced,
    acceptExternalChanges,
    updateContent,
  } = useArtifactFileEditorState({
    filePath,
    content,
    readOnly,
  });

  const handleChange = useCallback(
    (value: string | undefined) => {
      updateContent(value ?? "");
    },
    [updateContent]
  );

  if (!isContentMode && isLoading && !syncedContent) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading file...
      </div>
    );
  }

  return (
    <ArtifactFileEditorFrame
      filePath={filePath}
      isDeleted={isDeleted}
      isDesynced={isDesynced}
      saveStatus={saveStatus}
      errorMessage={errorMessage}
      onDiscardChanges={acceptExternalChanges}
    >
      <Editor
        height="100%"
        language={language}
        value={currentContent}
        onChange={handleChange}
        theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          tabSize: 2,
          readOnly: effectiveReadOnly || isDeleted,
          padding: { top: 8 },
        }}
        loading={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            Loading editor...
          </div>
        }
      />
    </ArtifactFileEditorFrame>
  );
}
