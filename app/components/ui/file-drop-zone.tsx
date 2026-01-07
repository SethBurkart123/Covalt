"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface FileDropZoneContextValue {
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: File[]) => void;
}

const FileDropZoneContext = React.createContext<FileDropZoneContextValue | null>(
  null
);

function useFileDropZone() {
  const context = React.useContext(FileDropZoneContext);
  if (!context) {
    throw new Error("FileDropZone components must be used within FileDropZone");
  }
  return context;
}

interface FileDropZoneProps {
  children: React.ReactNode;
  onFilesDrop: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
  disabled?: boolean;
}

const FileDropZone = React.forwardRef<HTMLDivElement, FileDropZoneProps>(
  (
    {
      children,
      onFilesDrop,
      accept = "image/*,application/pdf,audio/*,video/*,.txt,.csv,.json,.doc,.docx",
      multiple = true,
      className,
      disabled = false,
    },
    ref
  ) => {
    const [isDragging, setIsDragging] = React.useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const dragCounterRef = React.useRef(0);

    const handleFiles = React.useCallback(
      (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        if (fileArray.length > 0 && !disabled) {
          onFilesDrop(fileArray);
        }
      },
      [onFilesDrop, disabled]
    );

    const handleFileSelect = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
          handleFiles(e.target.files);
          // Reset input so the same file can be selected again
          e.target.value = "";
        }
      },
      [handleFiles]
    );

    const handleDragEnter = React.useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes("Files") && !disabled) {
          setIsDragging(true);
        }
      },
      [disabled]
    );

    const handleDragLeave = React.useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    }, []);

    const handleDragOver = React.useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    }, []);

    const handleDrop = React.useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounterRef.current = 0;

        if (!disabled && e.dataTransfer.files) {
          handleFiles(e.dataTransfer.files);
        }
      },
      [handleFiles, disabled]
    );

    const contextValue = React.useMemo<FileDropZoneContextValue>(
      () => ({
        isDragging,
        fileInputRef,
        onFilesSelected: handleFiles,
      }),
      [isDragging, handleFiles]
    );

    return (
      <FileDropZoneContext.Provider value={contextValue}>
        <div
          ref={ref}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn("relative", className)}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            multiple={multiple}
            accept={accept}
            className="hidden"
            disabled={disabled}
          />

          <AnimatePresence>
            {isDragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-sm ring-4 ring-card"
              >
                <div className="flex flex-col items-center gap-2 text-primary">
                  <Paperclip className="size-8" />
                  <span className="text-sm font-medium">Drop files here</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {children}
        </div>
      </FileDropZoneContext.Provider>
    );
  }
);

FileDropZone.displayName = "FileDropZone";

interface FileDropZoneTriggerProps
  extends React.ComponentPropsWithoutRef<"button"> {
  asChild?: boolean;
}

const FileDropZoneTrigger = React.forwardRef<
  HTMLButtonElement,
  FileDropZoneTriggerProps
>(({ asChild = false, onClick, disabled, ...props }, ref) => {
  const { fileInputRef } = useFileDropZone();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (onClick) {
      onClick(e);
    }
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  if (asChild) {
    return React.cloneElement(
      props.children as React.ReactElement,
      {
        onClick: handleClick,
        disabled,
        ...props,
      } as React.ComponentPropsWithoutRef<"button">
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      disabled={disabled}
      {...props}
    />
  );
});

FileDropZoneTrigger.displayName = "FileDropZoneTrigger";

export { FileDropZone, FileDropZoneTrigger, useFileDropZone };

