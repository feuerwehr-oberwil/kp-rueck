'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { PageNavigation } from '@/components/page-navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { useEvent } from '@/lib/contexts/event-context';
import { useAuth } from '@/lib/contexts/auth-context';
import { useIsMobile } from '@/components/ui/use-mobile';
import { cn } from '@/lib/utils';
import { useGlobalNavigation } from '@/lib/hooks/use-global-navigation';

interface TocItem {
  id: string;
  text: string;
  level: number;
  search?: string;
}

// Extract plain text from React children (which may contain nested <mark>
// elements once search highlighting is applied) so heading ids stay stable.
function getNodeText(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join('');
  if (typeof node === 'object' && node.props) return getNodeText(node.props.children);
  return '';
}

// rehype plugin: wrap case-insensitive matches of `query` in <mark> elements,
// skipping code/pre so keyboard shortcuts and code stay untouched.
function rehypeHighlight(options: { query?: string }) {
  const query = (options?.query ?? '').toLowerCase();
  return (tree: any) => {
    if (query.length < 2) return;

    const visit = (node: any) => {
      if (!node.children || node.children.length === 0) return;
      if (node.tagName === 'code' || node.tagName === 'pre') return;

      const next: any[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value.toLowerCase().includes(query)) {
          const value: string = child.value;
          const lower = value.toLowerCase();
          let i = 0;
          let idx: number;
          while ((idx = lower.indexOf(query, i)) !== -1) {
            if (idx > i) next.push({ type: 'text', value: value.slice(i, idx) });
            next.push({
              type: 'element',
              tagName: 'mark',
              properties: {},
              children: [{ type: 'text', value: value.slice(idx, idx + query.length) }],
            });
            i = idx + query.length;
          }
          if (i < value.length) next.push({ type: 'text', value: value.slice(i) });
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };

    visit(tree);
  };
}

export default function HelpPage() {
  const t = useTranslations('help.page');
  const { selectedEvent } = useEvent();
  const { isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  useGlobalNavigation();
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

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
          setContent(t('loadError'));
        }
      } catch (error) {
        console.error('Failed to load help content:', error);
        setContent(t('loadError'));
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, []);

  // Extract table of contents from markdown (h2 only), capturing each
  // section's body text so search can match content, not just headings.
  const tableOfContents = useMemo<TocItem[]>(() => {
    if (!content) return [];

    const headingRegex = /^(#{2})\s+(.+)$/gm;
    const toc: TocItem[] = [];
    const matches: { level: number; text: string; end: number; start: number }[] = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      matches.push({
        level: match[1].length,
        text: match[2],
        start: match.index,
        end: headingRegex.lastIndex,
      });
    }

    matches.forEach((m, i) => {
      const bodyEnd = i + 1 < matches.length ? matches[i + 1].start : content.length;
      const body = content.slice(m.end, bodyEnd);
      const id = m.text
        .toLowerCase()
        .replace(/[`]/g, '')
        .replace(/[^a-z0-9äöüß\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();

      toc.push({ id, text: m.text, level: m.level, search: (m.text + ' ' + body).toLowerCase() });
    });

    return toc;
  }, [content]);

  // Filter the TOC by the search query (matches heading + section body text)
  const filteredToc = useMemo<TocItem[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tableOfContents;
    return tableOfContents.filter((item) => item.search?.includes(query));
  }, [tableOfContents, searchQuery]);

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
      const text = getNodeText(children);
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
      const text = getNodeText(children);
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
    // Search highlight
    mark: ({ children, ...props }: any) => (
      <mark className="bg-primary/25 text-foreground rounded px-0.5" {...props}>
        {children}
      </mark>
    ),
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('title')}</h1>
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
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('searchPlaceholder')}
                    aria-label={t('searchPlaceholder')}
                    className="h-8 pl-8 pr-8 text-sm"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label={t('searchClear')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t('toc')}
                </p>
                {filteredToc.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-2 py-1">{t('searchNoResults')}</p>
                ) : (
                  <ul className="space-y-1">
                    {filteredToc.map(({ id, text }) => (
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
                )}
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
                <p className="mt-4 text-muted-foreground">{t('loading')}</p>
              </div>
            ) : (
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[[rehypeHighlight, { query: searchQuery.trim() }]]}
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
