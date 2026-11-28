/* eslint-disable react/prop-types */

const displayValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    return value.name || value.filename || value.file_name || value.url || "Available";
  }
  return String(value);
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? displayValue(value)
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const getMessage = (entry) => {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return null;
  return entry.message || entry.comment || entry.reply || entry.response || entry.body || null;
};

const getLatestEntry = (ticket, fields, collections) => {
  for (const field of fields) {
    const message = getMessage(ticket[field]);
    if (message) return { message, date: ticket[`${field}_at`] || ticket[`${field}_on`] };
  }

  for (const collection of collections) {
    const entries = ticket[collection];
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const latest = [...entries].sort((left, right) => {
      const leftDate = new Date(left?.created_at || left?.added_on || left?.date || 0).getTime();
      const rightDate = new Date(right?.created_at || right?.added_on || right?.date || 0).getTime();
      return leftDate - rightDate;
    }).at(-1);
    const message = getMessage(latest);
    if (message) return { message, date: latest?.created_at || latest?.added_on || latest?.date };
  }
  return null;
};

const TicketField = ({ label, value }) => (
  <div className="min-w-0">
    <dt className="text-xs font-medium text-slate-500">{label}</dt>
    <dd className="mt-1 truncate text-sm font-medium text-slate-800" title={displayValue(value)}>
      {displayValue(value)}
    </dd>
  </div>
);

const TicketResponse = ({ response }) => {
  const author = response.added_by?.name || response.added_by?.email || "Unknown";
  const visibility = response.vendor_display === undefined
    ? "Visibility not provided"
    : response.vendor_display
      ? "Visible to vendor"
      : "Internal";

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-slate-800">{author}</p>
        <time className="text-xs text-slate-500" dateTime={response.added_on || undefined}>
          {formatDate(response.added_on)}
        </time>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
        {displayValue(response.message)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>Response #{displayValue(response.id)}</span>
        {response.added_by?.id !== undefined && response.added_by?.id !== null && (
          <span>Author ID: {response.added_by.id}</span>
        )}
        <span>{visibility}</span>
      </div>
    </article>
  );
};

const NcmTicketDetails = ({ ticket, submittedReply }) => {
  const closed = Boolean(ticket.closed_on) || ticket.status === true || String(ticket.status).toLowerCase() === "closed";
  const vendor = ticket.vendor?.name || ticket.vendor_name;
  const branch = ticket.branch?.name || ticket.branch_name || ticket.branch;
  const responses = Array.isArray(ticket.responses)
    ? [...ticket.responses].sort((left, right) => (
      new Date(right.added_on || 0).getTime() - new Date(left.added_on || 0).getTime()
    ))
    : [];
  const latestReply = responses[0] || getLatestEntry(
    ticket,
    ["latest_reply", "latestReply", "reply", "response", "latest_response", "latestResponse"],
    ["replies"],
  ) || (submittedReply ? { message: submittedReply.message, date: submittedReply.date } : null);
  const latestComment = getLatestEntry(
    ticket,
    ["latest_comment", "latestComment", "comment"],
    ["comments"],
  );

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">NCM ticket</h3>
          <p className="mt-0.5 text-xs text-slate-500">Ticket #{displayValue(ticket.id)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${closed ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
          {closed ? "Closed" : "Open"}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 sm:grid-cols-3 lg:grid-cols-4">
        <TicketField label="Ticket status" value={closed ? "Closed" : "Open"} />
        <TicketField label="Type" value={ticket.ticket_type} />
        <TicketField label="Created" value={formatDate(ticket.added_on)} />
        <TicketField label="Closed" value={formatDate(ticket.closed_on)} />
        <TicketField label="Branch" value={branch} />
        <TicketField label="Vendor" value={vendor ? `${vendor}${ticket.vendor?.id ? ` (#${ticket.vendor.id})` : ""}` : null} />
        <TicketField label="Assigned to" value={ticket.assigned_to?.name || ticket.assigned_to?.email} />
        <TicketField label="Assigned user ID" value={ticket.assigned_to?.id} />
        <TicketField label="Closed by" value={ticket.closed_by?.name || ticket.closed_by?.email} />
        <TicketField label="Closed-by user ID" value={ticket.closed_by?.id} />
        <TicketField label="Attachment" value={ticket.attachment} />
      </dl>

      <div className="space-y-5 border-t border-slate-100 p-4">
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket message</h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
            {displayValue(ticket.message)}
          </p>
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Replies</h4>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {responses.length} {responses.length === 1 ? "reply" : "replies"}
            </span>
          </div>
          {responses.length > 0 ? (
            <div className="space-y-2">
              {responses.map((response, index) => (
                <TicketResponse key={response.id ?? `${response.added_on}-${index}`} response={response} />
              ))}
            </div>
          ) : latestReply ? (
            <TicketResponse response={{
              id: latestReply.id,
              message: latestReply.message,
              added_on: latestReply.added_on || latestReply.date,
              added_by: latestReply.added_by,
              vendor_display: latestReply.vendor_display,
            }} />
          ) : submittedReply ? (
            <TicketResponse response={{ ...submittedReply, added_by: { name: "You" } }} />
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No replies have been added.</p>
          )}
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest comment</h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
            {displayValue(latestComment?.message)}
          </p>
          {latestComment?.date && <p className="mt-1 text-xs text-slate-400">{formatDate(latestComment.date)}</p>}
        </section>
      </div>
    </section>
  );
};

export default NcmTicketDetails;
