"use client";

/**
 * Monaco SQL editor wired to the locally bundled monaco-editor package
 * (offline-capable; the default @monaco-editor/react loader pulls from a CDN).
 *
 * Must only ever load in the browser — import this lazily via next/dynamic
 * with ssr: false (see page.tsx).
 */
import { useEffect } from "react";
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import Editor from "@monaco-editor/react";

loader.config({ monaco });

// Provide a worker to Monaco so tokenization / completion run off the main
// thread, using a locally bundled copy of its editor worker.
if (typeof window !== "undefined") {
  window.MonacoEnvironment = {
    getWorker: () =>
      new Worker(
        new URL("monaco-editor/editor/editor.worker", import.meta.url),
        { type: "module" },
      ),
  };
}

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "FULL", "INNER", "OUTER",
  "ON", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET", "HAVING", "AS", "AND", "OR",
  "NOT", "NULL", "IN", "BETWEEN", "LIKE", "CASE", "WHEN", "THEN", "ELSE", "END",
  "DESC", "ASC", "CREATE", "TABLE", "INSERT", "INTO", "VALUES", "DROP",
  "UNION", "ALL", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX",
];

const SCHEMA_COLUMNS = [
  "customers.id", "customers.name", "customers.country",
  "orders.order_id", "orders.customer_id", "orders.amount",
];

function registerSqlProvider() {
  return monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [" ", ".", ","],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const keywords: monaco.languages.CompletionItem[] = SQL_KEYWORDS.map((w) => ({
        label: w,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: w,
        detail: "SQL keyword",
        range,
      }));
      const columns: monaco.languages.CompletionItem[] = SCHEMA_COLUMNS.map(
        (path) => ({
          label: path,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: path,
          detail: "demo table column",
          range,
        }),
      );
      return { suggestions: [...keywords, ...columns] };
    },
  });
}

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  dark?: boolean;
}

export default function SqlEditor({ value, onChange, dark = true }: SqlEditorProps) {
  useEffect(() => {
    const disposable = registerSqlProvider();
    return () => disposable.dispose();
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <Editor
        language="sql"
        theme={dark ? "vs-dark" : "light"}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "var(--font-geist-mono), monospace",
          tabSize: 2,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}