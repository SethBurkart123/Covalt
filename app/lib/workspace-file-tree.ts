export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const path of paths) {
    const parts = path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join("/");

      let node = current.find((n) => n.name === part);

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: isLast ? undefined : [],
        };
        current.push(node);
      }

      if (!isLast && node.children) {
        current = node.children;
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] =>
    nodes
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((node) => ({
        ...node,
        children: node.children ? sortNodes(node.children) : undefined,
      }));

  return sortNodes(root);
}
