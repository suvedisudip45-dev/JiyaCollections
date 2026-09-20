import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { backendUrl } from "../App";
import { toast } from "react-toastify";

const defaultTemplateBody = `Dear {{customer.first_name}},

{{opening}}

{{story_content}}

{{continuity}}

{{closing}}

{{signature}}`;

const emptyStoryForm = {
  title: "",
  description: "",
  status: "ACTIVE",
  assignmentEnabled: true,
  allowNewCustomers: true,
  allowAfterCompletion: true,
  assignmentWeight: 1,
};

const emptyLetterForm = {
  sequenceNumber: 1,
  title: "",
  summary: "",
  continuitySummary: "",
  content: "",
  status: "ACTIVE",
};

const emptyTemplateForm = {
  name: "",
  description: "",
  status: "ACTIVE",
  selectionWeight: 1,
  repetitionWindow: 3,
  body: defaultTemplateBody,
};

const StoryLetterLibrary = ({ token }) => {
  const [stories, setStories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedStoryId, setSelectedStoryId] = useState("");
  const [letters, setLetters] = useState([]);
  const [storyForm, setStoryForm] = useState(emptyStoryForm);
  const [letterForm, setLetterForm] = useState(emptyLetterForm);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [loading, setLoading] = useState(true);
  const [savingStory, setSavingStory] = useState(false);
  const [savingLetter, setSavingLetter] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const samplePreview = useMemo(() => {
    return templateForm.body
      .replace(/{{customer\.first_name}}/g, "आरव")
      .replace(/{{opening}}/g, "यो हाम्रो कथाको शुरुवात हो, जहाँ भविष्यको उज्यालो हामीलाई मुस्कुराउँछ।")
      .replace(/{{story_content}}/g, "सहज एउटा पत्र आउँछ जसले हाम्रा मनमा आशा र खुशीको नयाँ कथालाई लिएर आउँछ।")
      .replace(/{{continuity}}/g, "यो यात्रा न्यानो हावा, विश्वास र उज्यालो भविष्यको साथ अगाडि बढिरहेको छ।")
      .replace(/{{closing}}/g, "तत्कालका लागि, यो स्मरणीय पत्रले तपाईको जीवनमा प्रसन्नता र आशाको भावना दिन्छ।")
      .replace(/{{signature}}/g, "प्रेम सहित,\nद आमा स्टोरी टीम");
  }, [templateForm.body]);

  const fetchLibrary = async () => {
    try {
      setLoading(true);
      const [storiesRes, templatesRes] = await Promise.all([
        axios.get(`${backendUrl}/api/admin/story-letter/stories`, { headers: { token } }),
        axios.get(`${backendUrl}/api/admin/story-letter/templates`, { headers: { token } }),
      ]);

      const storyData = storiesRes.data?.data || [];
      const templateData = templatesRes.data?.data || [];
      setStories(storyData);
      setTemplates(templateData);

      if (storyData.length && !selectedStoryId) {
        setSelectedStoryId(storyData[0].id);
      }

      if (!storyData.length) {
        setSelectedStoryId("");
        setLetters([]);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || "Failed to load story-letter library");
    } finally {
      setLoading(false);
    }
  };

  const fetchStoryLetters = async (storyId) => {
    if (!storyId) {
      setLetters([]);
      return;
    }

    try {
      const res = await axios.get(`${backendUrl}/api/admin/story-letter/stories/${storyId}/letters`, {
        headers: { token },
      });
      setLetters(res.data?.data || []);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || "Failed to load story letters");
    }
  };

  useEffect(() => {
    if (token) {
      fetchLibrary();
    }
  }, [token]);

  useEffect(() => {
    if (selectedStoryId) {
      fetchStoryLetters(selectedStoryId);
    }
  }, [selectedStoryId]);

  const handleCreateStory = async (e) => {
    e.preventDefault();
    if (!storyForm.title.trim()) {
      toast.error("Story title is required");
      return;
    }

    try {
      setSavingStory(true);
      const res = await axios.post(`${backendUrl}/api/admin/story-letter/stories`, storyForm, {
        headers: { token },
      });

      if (res.data.success) {
        toast.success("Story created");
        setStoryForm(emptyStoryForm);
        await fetchLibrary();
        setSelectedStoryId(res.data.data?.id || selectedStoryId);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to create story");
    } finally {
      setSavingStory(false);
    }
  };

  const handleCreateLetter = async (e) => {
    e.preventDefault();
    if (!selectedStoryId) {
      toast.error("Select a story before creating a letter");
      return;
    }
    if (!letterForm.title.trim() || !letterForm.content.trim()) {
      toast.error("Letter title and content are required");
      return;
    }

    try {
      setSavingLetter(true);
      const res = await axios.post(`${backendUrl}/api/admin/story-letter/stories/${selectedStoryId}/letters`, letterForm, {
        headers: { token },
      });

      if (res.data.success) {
        toast.success("Letter added to story");
        setLetterForm(emptyLetterForm);
        await fetchStoryLetters(selectedStoryId);
        await fetchLibrary();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to create letter");
    } finally {
      setSavingLetter(false);
    }
  };

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    if (!templateForm.name.trim() || !templateForm.body.trim()) {
      toast.error("Template name and body are required");
      return;
    }

    try {
      setSavingTemplate(true);
      const res = await axios.post(`${backendUrl}/api/admin/story-letter/templates`, templateForm, {
        headers: { token },
      });

      if (res.data.success) {
        toast.success("Template saved");
        setTemplateForm(emptyTemplateForm);
        await fetchLibrary();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to create template");
    } finally {
      setSavingTemplate(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600">Story Letter Library</p>
          <h1 className="text-2xl font-black text-slate-900">Customer Story System</h1>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading story library...</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800 mb-4">1) Create story</h2>
            <form onSubmit={handleCreateStory} className="space-y-3">
              <input
                value={storyForm.title}
                onChange={(e) => setStoryForm({ ...storyForm, title: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                placeholder="Story title"
              />
              <textarea
                value={storyForm.description}
                onChange={(e) => setStoryForm({ ...storyForm, description: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[88px] outline-none focus:border-violet-500"
                placeholder="Description"
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-600">
                  status
                  <select
                    value={storyForm.status}
                    onChange={(e) => setStoryForm({ ...storyForm, status: e.target.value })}
                    className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="PAUSED">PAUSED</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  weight
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    value={storyForm.assignmentWeight}
                    onChange={(e) => setStoryForm({ ...storyForm, assignmentWeight: Number(e.target.value || 1) })}
                    className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <label className="flex items-center gap-2"><input type="checkbox" checked={storyForm.assignmentEnabled} onChange={(e) => setStoryForm({ ...storyForm, assignmentEnabled: e.target.checked })} /> enabled</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={storyForm.allowNewCustomers} onChange={(e) => setStoryForm({ ...storyForm, allowNewCustomers: e.target.checked })} /> new customers</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={storyForm.allowAfterCompletion} onChange={(e) => setStoryForm({ ...storyForm, allowAfterCompletion: e.target.checked })} /> after completion</label>
              </div>
              <button type="submit" disabled={savingStory} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-xl px-3 py-2 text-sm font-semibold">
                {savingStory ? "Saving..." : "Create Story"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800 mb-4">2) Add letters</h2>
            <div className="mb-3">
              <label className="text-xs text-slate-600">Select story</label>
              <select
                value={selectedStoryId}
                onChange={(e) => setSelectedStoryId(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
              >
                <option value="">Choose a story</option>
                {stories.map((story) => (
                  <option key={story.id} value={story.id}>{story.title}</option>
                ))}
              </select>
            </div>

            {selectedStoryId ? (
              <form onSubmit={handleCreateLetter} className="space-y-3">
                <input
                  type="number"
                  min="1"
                  value={letterForm.sequenceNumber}
                  onChange={(e) => setLetterForm({ ...letterForm, sequenceNumber: Number(e.target.value || 1) })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                  placeholder="Sequence number"
                />
                <input
                  value={letterForm.title}
                  onChange={(e) => setLetterForm({ ...letterForm, title: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                  placeholder="Letter title"
                />
                <input
                  value={letterForm.summary}
                  onChange={(e) => setLetterForm({ ...letterForm, summary: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                  placeholder="Short summary"
                />
                <textarea
                  value={letterForm.continuitySummary}
                  onChange={(e) => setLetterForm({ ...letterForm, continuitySummary: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[74px] outline-none focus:border-violet-500"
                  placeholder="Continuity summary"
                />
                <textarea
                  value={letterForm.content}
                  onChange={(e) => setLetterForm({ ...letterForm, content: e.target.value })}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[120px] outline-none focus:border-violet-500"
                  placeholder="Letter content"
                />
                <button type="submit" disabled={savingLetter} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl px-3 py-2 text-sm font-semibold">
                  {savingLetter ? "Saving..." : "Add Letter"}
                </button>
              </form>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">Create or select a story to add letters.</div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-800 mb-4">3) Create template</h2>
            <form onSubmit={handleCreateTemplate} className="space-y-3">
              <input
                value={templateForm.name}
                onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                placeholder="Template name"
              />
              <textarea
                value={templateForm.description}
                onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[72px] outline-none focus:border-violet-500"
                placeholder="Description"
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-600">
                  selection weight
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    value={templateForm.selectionWeight}
                    onChange={(e) => setTemplateForm({ ...templateForm, selectionWeight: Number(e.target.value || 1) })}
                    className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  repetition window
                  <input
                    type="number"
                    min="1"
                    value={templateForm.repetitionWindow}
                    onChange={(e) => setTemplateForm({ ...templateForm, repetitionWindow: Number(e.target.value || 3) })}
                    className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-500"
                  />
                </label>
              </div>
              <textarea
                value={templateForm.body}
                onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[180px] font-mono outline-none focus:border-violet-500"
                placeholder="Template body"
              />
              <div className="rounded-xl border border-violet-100 bg-violet-50 p-3 text-xs text-violet-800">
                <div className="font-bold mb-2">Preview</div>
                <pre className="whitespace-pre-wrap font-sans leading-6 text-[11.5px]">{samplePreview}</pre>
              </div>
              <button type="submit" disabled={savingTemplate} className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-xl px-3 py-2 text-sm font-semibold">
                {savingTemplate ? "Saving..." : "Create Template"}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-3">Story library</h2>
          <div className="space-y-3">
            {stories.length ? stories.map((story) => (
              <button
                key={story.id}
                type="button"
                onClick={() => setSelectedStoryId(story.id)}
                className={`w-full text-left rounded-xl border p-3 transition ${selectedStoryId === story.id ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-sm text-slate-800">{story.title}</div>
                    <div className="text-[11px] text-slate-500 mt-1">{story.description || "No description"}</div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{story.status}</span>
                </div>
                <div className="mt-2 flex gap-2 text-[10px] text-slate-500">
                  <span>{story.letterCount ?? 0} letters</span>
                  <span>•</span>
                  <span>{story.assignmentCount ?? 0} assignments</span>
                  <span>•</span>
                  <span>{story.deliveryCount ?? 0} deliveries</span>
                </div>
              </button>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">No stories yet. Create one to begin.</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-3">Template library</h2>
          <div className="space-y-3">
            {templates.length ? templates.map((template) => (
              <div key={template.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-sm text-slate-800">{template.name}</div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{template.status}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">{template.description || "No description"}</div>
                <div className="mt-2 text-[10px] text-slate-500">Weight: {template.selectionWeight} • Window: {template.repetitionWindow}</div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">No templates yet. Create one to seed the letter delivery flow.</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800 mb-3">Story letters</h2>
        {selectedStoryId ? (
          <div className="space-y-3">
            {letters.length ? letters.map((letter) => (
              <div key={letter.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-sm text-slate-800">#{letter.sequenceNumber} · {letter.title}</div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{letter.status}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">{letter.summary || "No summary"}</div>
                <div className="mt-2 text-[11px] text-slate-700 whitespace-pre-wrap">{letter.content}</div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">No letters for this story yet.</div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">Select a story to review its letters.</div>
        )}
      </div>
    </div>
  );
};

export default StoryLetterLibrary;
