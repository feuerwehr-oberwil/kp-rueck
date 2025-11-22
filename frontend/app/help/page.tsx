'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, ChevronRight, BookOpen, ChevronDown, ArrowRight, Library } from 'lucide-react';
import { PageNavigation } from '@/components/page-navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MobileNavigation } from '@/components/mobile-navigation';
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useEvent } from '@/lib/contexts/event-context';
import { useAuth } from '@/lib/contexts/auth-context';
import { useIsMobile } from '@/components/ui/use-mobile';
import Link from 'next/link';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface HelpTopic {
  id: string;
  title: string;
  category: string;
  file: string;
}

const HELP_TOPICS: HelpTopic[] = [
  { id: 'getting-started', title: 'Erste Schritte', category: 'Einführung', file: 'getting-started.md' },
  { id: 'online-offline-modes', title: 'Online & Offline Modi', category: 'Einführung', file: 'online-offline-modes.md' },
  { id: 'visual-feedback', title: 'Visuelle Hinweise & Bedienung', category: 'Einführung', file: 'visual-feedback.md' },
  { id: 'workflow', title: 'Einsatz-Workflow', category: 'Workflow', file: 'workflow.md' },
  { id: 'kanban', title: 'Kanban-Board', category: 'Features', file: 'kanban.md' },
  { id: 'map-combined', title: 'Karten & Combined View', category: 'Features', file: 'map-combined.md' },
  { id: 'events-management', title: 'Ereignis-Verwaltung', category: 'Features', file: 'events-management.md' },
  { id: 'training-mode', title: 'Training-Modus', category: 'Features', file: 'training-mode.md' },
  { id: 'check-in-reko', title: 'Check-In & Reko', category: 'Mobile Features', file: 'check-in-reko.md' },
  { id: 'keyboard-shortcuts', title: 'Tastaturkürzel', category: 'Referenz', file: 'keyboard-shortcuts.md' },
];

export default function HelpPage() {
  const { selectedEvent } = useEvent();
  const { isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const [selectedTopic, setSelectedTopic] = useState('getting-started');
  const [searchQuery, setSearchQuery] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Get next topic
  const nextTopic = useMemo(() => {
    const currentIndex = HELP_TOPICS.findIndex(t => t.id === selectedTopic);
    if (currentIndex === -1 || currentIndex === HELP_TOPICS.length - 1) return null;
    return HELP_TOPICS[currentIndex + 1];
  }, [selectedTopic]);

  // Parse markdown into sections (split by h2 headings)
  const sections = useMemo(() => {
    if (!content) return [];

    const lines = content.split('\n');
    const result: { title: string; content: string; id: string }[] = [];
    let currentSection: { title: string; content: string; id: string } | null = null;
    let beforeFirstH2: string[] = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        // Save previous section
        if (currentSection) {
          result.push(currentSection);
        }
        // Start new section
        const title = line.replace(/^##\s+/, '');
        const id = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        currentSection = { title, content: '', id };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      } else {
        beforeFirstH2.push(line);
      }
    }

    // Add last section
    if (currentSection) {
      result.push(currentSection);
    }

    // If there's content before first h2, add it as first section
    if (beforeFirstH2.length > 0 && beforeFirstH2.some(l => l.trim())) {
      result.unshift({ title: '', content: beforeFirstH2.join('\n'), id: 'intro' });
    }

    return result;
  }, [content]);

  // Load markdown content
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true);
      try {
        const topic = HELP_TOPICS.find(t => t.id === selectedTopic);
        if (!topic) return;

        const response = await fetch(`/content/help/${topic.file}`);
        if (response.ok) {
          const text = await response.text();
          setContent(text);
        } else {
          setContent(`# ${topic.title}\n\nInhalt wird geladen...`);
        }
      } catch (error) {
        console.error('Failed to load help content:', error);
        setContent('# Fehler\n\nDer Hilfeinhalt konnte nicht geladen werden.');
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [selectedTopic]);

  // Filter topics by search query
  const filteredTopics = useMemo(() => {
    if (!searchQuery) return HELP_TOPICS;
    const query = searchQuery.toLowerCase();
    return HELP_TOPICS.filter(topic =>
      topic.title.toLowerCase().includes(query) ||
      topic.category.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Group topics by category
  const groupedTopics = useMemo(() => {
    return filteredTopics.reduce((acc, topic) => {
      if (!acc[topic.category]) {
        acc[topic.category] = [];
      }
      acc[topic.category].push(topic);
      return acc;
    }, {} as Record<string, HelpTopic[]>);
  }, [filteredTopics]);

  // Helper to handle topic selection (also closes mobile sidebar)
  const handleTopicSelect = (topicId: string) => {
    setSelectedTopic(topicId);
    if (isMobile) {
      setMobileSidebarOpen(false);
    }
  };

  // Sidebar navigation content (shared between mobile and desktop)
  const SidebarContent = () => (
    <>
      {/* Search */}
      <div className="p-4 border-b bg-background">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Hilfe durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Topics List */}
      <ScrollArea className="flex-1">
        <nav className="p-2">
          {Object.entries(groupedTopics).map(([category, topics]) => (
            <div key={category} className="mb-6">
              <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {category}
              </h3>
              <div className="space-y-1">
                {topics.map(topic => (
                  <button
                    key={topic.id}
                    onClick={() => handleTopicSelect(topic.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition-colors ${
                      selectedTopic === topic.id
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <span>{topic.title}</span>
                    {selectedTopic === topic.id && (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>
    </>
  );

  // Shared ReactMarkdown components configuration
  const markdownComponents = {
    // Images
    img: ({ src, alt, ...props }: any) => (
      <img
        src={src}
        alt={alt}
        className="rounded-lg border shadow-md my-8 w-full"
        {...props}
      />
    ),
    // Code blocks
    code: ({ className, children, ...props }: any) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
            {children}
          </code>
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
      <div className="overflow-x-auto my-8">
        <table className="min-w-full border-collapse" {...props}>
          {children}
        </table>
      </div>
    ),
    // List items with better spacing
    ul: ({ children, ...props }: any) => (
      <ul className="space-y-2 my-6 list-disc pl-6" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }: any) => (
      <ol className="space-y-2 my-6 list-decimal pl-6" {...props}>
        {children}
      </ol>
    ),
    li: ({ children, ...props }: any) => (
      <li className="leading-7 pl-2" {...props}>
        {children}
      </li>
    ),
    // Checkboxes
    input: ({ type, ...props }: any) => {
      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            className="mr-2 rounded border-gray-300"
            {...props}
          />
        );
      }
      return <input type={type} {...props} />;
    },
    // Links
    a: ({ href, children, ...props }: any) => (
      <a
        href={href}
        className="text-primary hover:underline font-medium"
        target={href?.startsWith('http') ? '_blank' : undefined}
        rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
        {...props}
      >
        {children}
      </a>
    ),
    // Headings with better separation
    h1: ({ children, ...props }: any) => (
      <h1 className="text-3xl font-bold mt-8 mb-4 pb-2 border-b" {...props}>
        {children}
      </h1>
    ),
    h2: ({ children, ...props }: any) => (
      <h2 className="text-2xl font-bold mt-8 mb-4" {...props}>
        {children}
      </h2>
    ),
    h3: ({ children, ...props }: any) => (
      <h3 className="text-xl font-bold mt-6 mb-3" {...props}>
        {children}
      </h3>
    ),
    // Paragraphs with better spacing
    p: ({ children, ...props }: any) => (
      <p className="my-4 leading-7 text-foreground" {...props}>
        {children}
      </p>
    ),
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-4 min-h-20">
        <div className="flex items-center gap-3">
          {/* Mobile: Menu button to open topics */}
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex-shrink-0"
            >
              <Library className="h-5 w-5" />
            </Button>
          )}
          <BookOpen className="w-6 h-6 md:w-8 md:h-8 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg md:text-2xl font-bold tracking-tight truncate">Hilfe & Dokumentation</h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
              Umfassende Anleitungen für KP Rück
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
          {/* Desktop: Full navigation, Mobile: MobileNavigation */}
          {!isMobile && isAuthenticated && (
            <PageNavigation currentPage="help" hasSelectedEvent={!!selectedEvent} />
          )}
          {isMobile && isAuthenticated && (
            <MobileNavigation hasSelectedEvent={!!selectedEvent} />
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop: Sidebar Navigation */}
        {!isMobile && (
          <div className="w-80 border-r bg-muted/20 flex flex-col">
            <SidebarContent />
          </div>
        )}

        {/* Mobile: Sidebar in Sheet */}
        {isMobile && (
          <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent side="left" className="w-80 p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle>Hilfethemen</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col h-[calc(100%-5rem)]">
                <SidebarContent />
              </div>
            </SheetContent>
          </Sheet>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto p-4 md:p-8">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="mt-4 text-muted-foreground">Lädt...</p>
              </div>
            ) : (
              <div>
                {sections.map((section, index) => (
                  <div key={section.id || index}>
                    {section.title ? (
                      // Section with h2 heading - make it collapsible
                      <Collapsible
                        open={expandedSections[section.id] ?? false}
                        onOpenChange={(open) => setExpandedSections(prev => ({ ...prev, [section.id]: open }))}
                        className="mb-6"
                      >
                        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group hover:text-primary transition-colors">
                          <ChevronDown className={`w-5 h-5 flex-shrink-0 transition-transform ${expandedSections[section.id] ? 'rotate-0' : '-rotate-90'}`} />
                          <h2 className="text-2xl font-bold">{section.title}</h2>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-4 ml-7 prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-headings:font-bold prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3 prose-p:my-4 prose-p:leading-7 prose-ul:my-6 prose-li:my-2 prose-li:leading-7">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {section.content}
                            </ReactMarkdown>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      // Intro section (content before first h2) - always visible
                      <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3 prose-p:my-4 prose-p:leading-7 prose-ul:my-6 prose-li:my-2 prose-li:leading-7 mb-8">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {section.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}

                {/* Next Button */}
                {!isLoading && nextTopic && (
                  <div className="mt-12 pt-8 border-t">
                    <Button
                      onClick={() => setSelectedTopic(nextTopic.id)}
                      size="lg"
                      className="w-full sm:w-auto"
                    >
                      <span>Weiter: {nextTopic.title}</span>
                      <ArrowRight className="ml-2 w-5 h-5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
