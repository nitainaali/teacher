import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { Components } from "react-markdown";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const components: Components = {
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-700">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-gray-200 border border-gray-600 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-gray-300 border border-gray-600">{children}</td>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = !!className?.includes("language-");
    return isBlock ? (
      <pre className="bg-gray-900 rounded-lg p-3 overflow-x-auto text-sm my-2">
        <code className={className}>{children}</code>
      </pre>
    ) : (
      <code className="bg-gray-900 px-1 py-0.5 rounded text-blue-300 text-sm" {...props}>
        {children}
      </code>
    );
  },
  h1: ({ children }) => (
    <h1 dir="auto" className="text-xl font-bold mt-4 mb-2 text-white">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 dir="auto" className="text-lg font-semibold mt-3 mb-2 text-white border-b border-gray-700 pb-1">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 dir="auto" className="text-base font-medium mt-2 mb-1 text-gray-100">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul dir="auto" className="list-disc list-inside space-y-1 my-2 text-gray-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol dir="auto" className="list-decimal list-inside space-y-1 my-2 text-gray-300">{children}</ol>
  ),
  li: ({ children }) => <li dir="auto" className="text-gray-300 leading-relaxed">{children}</li>,
  p: ({ children }) => <p dir="auto" className="mb-2 leading-relaxed text-gray-200">{children}</p>,
  blockquote: ({ children }) => (
    <blockquote dir="auto" className="border-l-4 border-blue-500 pl-4 italic text-gray-400 my-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-gray-600 my-4" />,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-blue-400 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
};

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  if (!content) return null;
  return (
    <div dir="auto" className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: "inherit" }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
