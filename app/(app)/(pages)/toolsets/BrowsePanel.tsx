"use client";

import { useState } from "react";
import {
  Search,
  Package,
  Code,
  FileText,
  Database,
  Globe,
  Sparkles,
  Download,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const CATEGORIES = [
  { id: "all", label: "All", icon: Sparkles },
  { id: "developer", label: "Developer", icon: Code },
  { id: "productivity", label: "Productivity", icon: FileText },
  { id: "data", label: "Data & APIs", icon: Database },
  { id: "web", label: "Web", icon: Globe },
];

const FEATURED_TOOLSETS = [
  {
    id: "github-tools",
    name: "GitHub Tools",
    description: "Create issues, PRs, and manage repositories",
    category: "developer",
    downloads: "2.4k",
    featured: true,
  },
  {
    id: "web-scraper",
    name: "Web Scraper",
    description: "Extract data from websites with smart parsing",
    category: "web",
    downloads: "1.8k",
    featured: true,
  },
];

const BROWSE_TOOLSETS = [
  {
    id: "sql-assistant",
    name: "SQL Assistant",
    description: "Query databases and analyze results",
    category: "data",
    downloads: "956",
  },
  {
    id: "markdown-tools",
    name: "Markdown Tools",
    description: "Convert, format, and preview markdown files",
    category: "productivity",
    downloads: "1.2k",
  },
  {
    id: "api-tester",
    name: "API Tester",
    description: "Test REST APIs with automatic schema detection",
    category: "developer",
    downloads: "834",
  },
  {
    id: "image-processor",
    name: "Image Processor",
    description: "Resize, crop, and convert images",
    category: "productivity",
    downloads: "567",
  },
  {
    id: "json-tools",
    name: "JSON Tools",
    description: "Parse, validate, and transform JSON data",
    category: "data",
    downloads: "1.5k",
  },
  {
    id: "code-formatter",
    name: "Code Formatter",
    description: "Format code in multiple languages",
    category: "developer",
    downloads: "723",
  },
];

interface ToolsetCardProps {
  toolset: {
    id: string;
    name: string;
    description: string;
    category: string;
    downloads: string;
    featured?: boolean;
  };
}

function ToolsetCard({ toolset }: ToolsetCardProps) {
  const category = CATEGORIES.find((c) => c.id === toolset.category);
  const CategoryIcon = category?.icon || Package;

  return (
    <div className="group relative flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-center size-10 rounded-lg bg-muted flex-shrink-0">
        <CategoryIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{toolset.name}</span>
          {toolset.featured && (
            <Star className="size-3 text-amber-500 fill-amber-500" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {toolset.description}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Download className="size-3" />
          {toolset.downloads}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          disabled
        >
          Install
        </Button>
      </div>

      <div className="absolute inset-0 rounded-lg bg-background/60 backdrop-blur-[1px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
          Coming Soon
        </span>
      </div>
    </div>
  );
}

export default function BrowsePanel() {
  const [activeCategory, setActiveCategory] = useState("all");

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search toolsets..."
          className="pl-10"
          disabled
        />
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            onClick={() => setActiveCategory(category.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
              activeCategory === category.id
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            <category.icon className="size-3.5" />
            {category.label}
          </button>
        ))}
      </div>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="size-4 text-amber-500" />
          <h2 className="text-sm font-medium">Featured</h2>
        </div>
        <div className="space-y-2">
          {FEATURED_TOOLSETS.map((toolset) => (
            <ToolsetCard key={toolset.id} toolset={toolset} />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Package className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">All Toolsets</h2>
        </div>
        <div className="space-y-2">
          {BROWSE_TOOLSETS.map((toolset) => (
            <ToolsetCard key={toolset.id} toolset={toolset} />
          ))}
        </div>
      </section>

      <div className="text-center py-6 border-t border-border">
        <p className="text-sm text-muted-foreground">
          The toolset marketplace is coming soon. You&apos;ll be able to discover and install
          toolsets created by the community.
        </p>
      </div>
    </div>
  );
}
