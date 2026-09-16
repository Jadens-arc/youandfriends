'use client';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  ScrollArea,
  Separator,
  Skeleton,
  SplitPane,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@youandfriends/ui';

import { Section, States } from './scaffold';

export function Structure() {
  return (
    <>
      <Section id="tabs" title="Tabs">
        <States label="Default and disabled" testId="showcase-tabs" className="!items-start">
          <Tabs defaultValue="lyrics" className="w-96">
            <TabsList>
              <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
              <TabsTrigger value="files" disabled>
                Files
              </TabsTrigger>
            </TabsList>
            <TabsContent value="lyrics">The lyrics editor arrives in task 081.</TabsContent>
            <TabsContent value="versions">Three versions, newest first.</TabsContent>
          </Tabs>
        </States>
      </Section>

      <Section id="display" title="Avatar, separator, scroll area, skeleton">
        <States label="Avatar — image, fallback, and a failed image" testId="showcase-avatar">
          <Avatar>
            <AvatarImage src="/avatar-example.svg" alt="" />
            <AvatarFallback>AV</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>AV</AvatarFallback>
          </Avatar>
          <Avatar>
            {/* A broken source is the state that actually ships: the fallback has to hold. */}
            <AvatarImage src="/does-not-exist.png" alt="" />
            <AvatarFallback>JD</AvatarFallback>
          </Avatar>
        </States>

        <States label="Separator" testId="showcase-separator" className="!items-start">
          <div className="w-64">
            <p className="text-body font-sans">Horizontal</p>
            <Separator className="my-2" />
            <p className="text-body font-sans">Below</p>
          </div>
          <div className="flex h-12 items-center gap-3">
            <span className="text-body font-sans">Left</span>
            <Separator orientation="vertical" />
            <span className="text-body font-sans">Right</span>
          </div>
        </States>

        <States label="Scroll area" testId="showcase-scroll-area" className="!items-start">
          <ScrollArea className="border-border h-40 w-64 rounded-md border p-3">
            <ol className="text-body flex flex-col gap-2 font-sans">
              {Array.from({ length: 20 }, (_, index) => (
                <li key={index}>Take {index + 1}</li>
              ))}
            </ol>
          </ScrollArea>
        </States>

        <States
          label="Skeleton — the loading state"
          testId="showcase-skeleton"
          className="!items-start"
        >
          <div className="flex w-64 flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-16 w-full" />
          </div>
        </States>
      </Section>

      <Section
        id="split-pane"
        title="Split pane"
        note="Drag the divider, or focus it and use the arrow keys. The position persists per storage key."
      >
        <States label="Desktop project view" testId="showcase-split-pane" className="!items-start">
          <SplitPane
            className="border-border h-48 w-full rounded-md border"
            label="Resize song list"
            storageKey="showcase-split"
            start={<div className="text-body p-3 font-sans">Song list</div>}
            end={<div className="text-body p-3 font-sans">Song detail</div>}
          />
        </States>
      </Section>
    </>
  );
}
