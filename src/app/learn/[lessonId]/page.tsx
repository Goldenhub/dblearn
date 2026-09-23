import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LessonView from "@/components/learn/LessonView";
import { COURSE_LESSONS, lessonFor } from "@/lib/lessons/curriculum";

export const dynamicParams = true;

export function generateStaticParams() {
  return COURSE_LESSONS.map(({ lesson }) => ({ lessonId: lesson.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}): Promise<Metadata> {
  const { lessonId } = await params;
  const loc = lessonFor(lessonId);
  return {
    title: loc ? `${loc.lesson.title} · Learn · dblearn` : "Lesson · dblearn",
    description: loc?.lesson.intro,
  };
}

export default async function Page({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  if (!lessonFor(lessonId)) notFound();
  return <LessonView lessonId={lessonId} />;
}