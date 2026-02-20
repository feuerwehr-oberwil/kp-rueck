'use client';

import { useState, useEffect, useMemo } from 'react';
import { PageNavigation } from '@/components/page-navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { useEvent } from '@/lib/contexts/event-context';
import { useAuth } from '@/lib/contexts/auth-context';
import { useIsMobile } from '@/components/ui/use-mobile';
import { cn } from '@/lib/utils';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

export default function HelpPage() {
  const { selectedEvent } = useEvent();
  const { isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>('');

  // Load markdown content
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/content/help/index.md');
        if (response.ok) {
          const text = await response.text();
          setContent(text);
        } else {
          setContent('# Fehler\n\nDer Hilfeinhalt konnte nicht geladen werden.');
        }
      } catch (error) {
        console.error('Failed to load help content:', error);
        setContent('# Fehler\n\nDer Hilfeinhalt konnte nicht geladen werden.');
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, []);

  // Extract table of contents from markdown (h2 only)
  const tableOfContents = useMemo<TocItem[]>(() => {
    if (!content) return [];

    const headingRegex = /^(#{2})\s+(.+)$/gm;
    const toc: TocItem[] = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2];
      const id = text
        .toLowerCase()
        .replace(/[`]/g, '')
        .replace(/[^a-z0-9äöüß\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();

      toc.push({ id, text, level });
    }

    return toc;
  }, [content]);

  // Track active section on scroll
  useEffect(() => {
    if (tableOfContents.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );

    // Observe all headings
    tableOfContents.forEach(({ id }) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [tableOfContents, isLoading]);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Markdown components configuration
  const markdownComponents = {
    // Code blocks (for kbd styling)
    code: ({ className, children, ...props }: any) => {
      const isInline = !className;
      if (isInline) {
        return (
          <kbd className="bg-muted border border-border px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
            {children}
          </kbd>
        );
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    // Tables
    table: ({ children, ...props }: any) => (
      <div className="overflow-x-auto my-6">
        <table className="min-w-full border-collapse border border-border rounded-lg" {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }: any) => (
      <thead className="bg-muted/50" {...props}>
        {children}
      </thead>
    ),
    th: ({ children, ...props }: any) => (
      <th className="border border-border px-4 py-2 text-left font-semibold text-sm" {...props}>
        {children}
      </th>
    ),
    td: ({ children, ...props }: any) => (
      <td className="border border-border px-4 py-2 text-sm" {...props}>
        {children}
      </td>
    ),
    // Lists
    ul: ({ children, ...props }: any) => (
      <ul className="space-y-1 my-4 list-disc pl-6" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }: any) => (
      <ol className="space-y-1 my-4 list-decimal pl-6" {...props}>
        {children}
      </ol>
    ),
    li: ({ children, ...props }: any) => (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    ),
    // Links
    a: ({ href, children, ...props }: any) => (
      <a
        href={href}
        className="text-primary hover:underline font-medium"
        {...props}
      >
        {children}
      </a>
    ),
    // Headings with IDs for navigation
    h1: ({ children, ...props }: any) => (
      <h1 className="text-3xl font-bold mt-8 mb-4 pb-2 border-b first:mt-0" {...props}>
        {children}
      </h1>
    ),
    h2: ({ children, ...props }: any) => {
      const text = String(children);
      const id = text
        .toLowerCase()
        .replace(/[`]/g, '')
        .replace(/[^a-z0-9äöüß\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();
      return (
        <h2 id={id} className="text-2xl font-bold mt-8 mb-4 scroll-mt-20" {...props}>
          {children}
        </h2>
      );
    },
    h3: ({ children, ...props }: any) => {
      const text = String(children);
      const id = text
        .toLowerCase()
        .replace(/[`]/g, '')
        .replace(/[^a-z0-9äöüß\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();
      return (
        <h3 id={id} className="text-lg font-semibold mt-6 mb-2 scroll-mt-20" {...props}>
          {children}
        </h3>
      );
    },
    // Paragraphs
    p: ({ children, ...props }: any) => (
      <p className="my-3 leading-relaxed text-foreground" {...props}>
        {children}
      </p>
    ),
    // Horizontal rule
    hr: ({ ...props }: any) => (
      <hr className="my-8 border-border" {...props} />
    ),
    // Strong/Bold
    strong: ({ children, ...props }: any) => (
      <strong className="font-semibold" {...props}>
        {children}
      </strong>
    ),
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Hilfe</h1>
        </div>
        <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
          {!isMobile && isAuthenticated && (
            <PageNavigation currentPage="help" hasSelectedEvent={!!selectedEvent} />
          )}
        </div>
      </header>

      {/* Main Content with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table of Contents Sidebar - hidden on mobile */}
        {!isMobile && !isLoading && tableOfContents.length > 0 && (
          <aside className="w-56 border-r border-border/50 bg-card/30 flex-shrink-0">
            <ScrollArea className="h-full">
              <nav className="p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Inhalt
                </p>
                <ul className="space-y-1">
                  {tableOfContents.map(({ id, text }) => (
                    <li key={id}>
                      <button
                        onClick={() => scrollToSection(id)}
                        className={cn(
                          "text-left w-full text-sm py-1 px-2 rounded transition-colors hover:bg-muted",
                          activeSection === id
                            ? "text-primary font-medium bg-muted"
                            : "text-muted-foreground"
                        )}
                      >
                        {text.replace(/`/g, '')}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </ScrollArea>
          </aside>
        )}

        {/* Main Content */}
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-8">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="mt-4 text-muted-foreground">Lädt...</p>
              </div>
            ) : (
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && <MobileBottomNavigation currentPage="help" hasSelectedEvent={!!selectedEvent} />}
    </div>
  );
}
