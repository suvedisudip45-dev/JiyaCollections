/* eslint-disable react/prop-types */

const normalizeContent = (content) => {
  if (typeof content === "string") {
    return content ? [{ type: "paragraph", text: content }] : [];
  }
  if (content && typeof content === "object" && Array.isArray(content.blocks)) {
    return content.blocks;
  }
  return [];
};

const StructuredDescriptionContent = ({ content, fallback = "" }) => {
  const blocks = normalizeContent(content);
  if (!blocks.length && fallback) {
    return <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{fallback}</p>;
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block?.type === "paragraph" && block.text) {
          return (
            <p key={`paragraph-${index}`} className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
              {block.text}
            </p>
          );
        }
        if (block?.type === "list" && Array.isArray(block.items)) {
          return (
            <ul key={`list-${index}`} className="list-inside list-disc space-y-1 text-xs leading-relaxed text-gray-700">
              {block.items.filter(Boolean).map((item, itemIndex) => (
                <li key={itemIndex} className="whitespace-pre-wrap">{item}</li>
              ))}
            </ul>
          );
        }
        if (block?.type === "table" && Array.isArray(block.headers) && block.headers.length) {
          return (
            <div key={`table-${index}`} className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="min-w-full border-collapse text-left text-xs">
                <thead className="bg-stone-100">
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={headerIndex} className="whitespace-nowrap border-b border-stone-200 px-4 py-3 font-bold text-gray-900">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(block.rows || []).map((row, rowIndex) => (
                    <tr key={rowIndex} className={rowIndex % 2 ? "bg-stone-50/70" : "bg-white"}>
                      {block.headers.map((_, columnIndex) => (
                        <td key={columnIndex} className="whitespace-pre-wrap border-b border-stone-100 px-4 py-3 text-gray-700 last:border-b-0">
                          {row?.[columnIndex] || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};

export default StructuredDescriptionContent;
