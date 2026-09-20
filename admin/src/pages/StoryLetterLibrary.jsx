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
  const [editingStoryId, setEditingStoryId] = useState(null);
  const [editingLetterId, setEditingLetterId] = useState(null);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [storyEditForm, setStoryEditForm] = useState(emptyStoryForm);
  const [letterEditForm, setLetterEditForm] = useState(emptyLetterForm);
  const [templateEditForm, setTemplateEditForm] = useState(emptyTemplateForm);
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

  const handleStartEditStory = (story) => {
    setEditingStoryId(story.id);
    setStoryEditForm({
      title: story.title,
      description: story.description || "",
      status: story.status,
      assignmentEnabled: story.assignmentEnabled,
      allowNewCustomers: story.allowNewCustomers,
      allowAfterCompletion: story.allowAfterCompletion,
      assignmentWeight: story.assignmentWeight ?? 1,
    });
  };

  const handleSaveStoryEdit = async (e) => {
    e.preventDefault();
    if (!editingStoryId) return;
    try {
      const res = await axios.patch(`${backendUrl}/api/admin/story-letter/stories/${editingStoryId}`, storyEditForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Story updated");
        setEditingStoryId(null);
        setStoryEditForm(emptyStoryForm);
        await fetchLibrary();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to update story");
    }
  };

  const handleStartEditLetter = (letter) => {
    setEditingLetterId(letter.id);
    setLetterEditForm({
      sequenceNumber: letter.sequenceNumber,
      title: letter.title,
      summary: letter.summary || "",
      continuitySummary: letter.continuitySummary || "",
      content: letter.content || "",
      status: letter.status,
    });
  };

  const handleSaveLetterEdit = async (e) => {
    e.preventDefault();
    if (!editingLetterId) return;
    try {
      const res = await axios.patch(`${backendUrl}/api/admin/story-letter/story-letters/${editingLetterId}`, letterEditForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Letter updated");
        setEditingLetterId(null);
        setLetterEditForm(emptyLetterForm);
        await fetchStoryLetters(selectedStoryId);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to update letter");
    }
  };

  const handleStartEditTemplate = (template) => {
    setEditingTemplateId(template.id);
    setTemplateEditForm({
      name: template.name,
      description: template.description || "",
      status: template.status,
      selectionWeight: template.selectionWeight ?? 1,
      repetitionWindow: template.repetitionWindow ?? 3,
      body: template.body,
    });
  };

  const handleSaveTemplateEdit = async (e) => {
    e.preventDefault();
    if (!editingTemplateId) return;
    try {
      const res = await axios.patch(`${backendUrl}/api/admin/story-letter/templates/${editingTemplateId}`, templateEditForm, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Template updated");
        setEditingTemplateId(null);
        setTemplateEditForm(emptyTemplateForm);
        await fetchLibrary();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to update template");
    }
  };

  const handleToggleArchive = async (type, item) => {
    try {
      const endpointMap = {
        story: `${backendUrl}/api/admin/story-letter/stories/${item.id}/toggle-archive`,
        letter: `${backendUrl}/api/admin/story-letter/story-letters/${item.id}/toggle-archive`,
        template: `${backendUrl}/api/admin/story-letter/templates/${item.id}/toggle-archive`,
      };
      const res = await axios.patch(endpointMap[type], {}, { headers: { token } });
      if (res.data.success) {
        toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} ${item.status === "ARCHIVED" ? "restored" : "archived"}`);
        if (type === "story") {
          await fetchLibrary();
        }
        if (type === "letter") {
          await fetchStoryLetters(selectedStoryId);
        }
        if (type === "template") {
          await fetchLibrary();
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.message || `Unable to update ${type}.`);
    }
  };

  const moveLetter = async (index, direction) => {
    if (!selectedStoryId) return;
    const nextLetters = [...letters];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= nextLetters.length) return;

    [nextLetters[index], nextLetters[targetIndex]] = [nextLetters[targetIndex], nextLetters[index]];
    setLetters(nextLetters);

    try {
      const idsInOrder = nextLetters.map((letter) => letter.id);
      const res = await axios.patch(`${backendUrl}/api/admin/story-letter/stories/${selectedStoryId}/letters/reorder`, { order: idsInOrder }, { headers: { token } });
      if (!res.data.success) {
        toast.error("Unable to reorder story letters");
        await fetchStoryLetters(selectedStoryId);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to reorder story letters");
      await fetchStoryLetters(selectedStoryId);
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
              <div key={story.id} className={`rounded-xl border p-3 transition ${selectedStoryId === story.id ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-slate-300"}`}>
                <button
                  type="button"
                  onClick={() => setSelectedStoryId(story.id)}
                  className="w-full text-left"
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
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => handleToggleArchive("story", story)} className="text-[10px] font-semibold text-amber-700 hover:underline">{story.status === "ARCHIVED" ? "Restore" : "Archive"}</button>
                  <button type="button" onClick={() => handleStartEditStory(story)} className="text-[10px] font-semibold text-violet-700 hover:underline">Edit</button>
                </div>
              </div>
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
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => handleToggleArchive("template", template)} className="text-[10px] font-semibold text-amber-700 hover:underline">{template.status === "ARCHIVED" ? "Restore" : "Archive"}</button>
                  <button type="button" onClick={() => handleStartEditTemplate(template)} className="text-[10px] font-semibold text-violet-700 hover:underline">Edit</button>
                </div>
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
            {letters.length ? letters.map((letter, index) => (
              <div key={letter.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-sm text-slate-800">#{letter.sequenceNumber} · {letter.title}</div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{letter.status}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">{letter.summary || "No summary"}</div>
                <div className="mt-2 text-[11px] text-slate-700 whitespace-pre-wrap">{letter.content}</div>
                <div className="mt-3 flex justify-end gap-2 flex-wrap">
                  <button type="button" onClick={() => moveLetter(index, -1)} disabled={index === 0} className="text-[10px] font-semibold text-slate-600 disabled:opacity-40 hover:underline">↑ Up</button>
                  <button type="button" onClick={() => moveLetter(index, 1)} disabled={index === letters.length - 1} className="text-[10px] font-semibold text-slate-600 disabled:opacity-40 hover:underline">↓ Down</button>
                  <button type="button" onClick={() => handleToggleArchive("letter", letter)} className="text-[10px] font-semibold text-amber-700 hover:underline">{letter.status === "ARCHIVED" ? "Restore" : "Archive"}</button>
                  <button type="button" onClick={() => handleStartEditLetter(letter)} className="text-[10px] font-semibold text-violet-700 hover:underline">Edit</button>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">No letters for this story yet.</div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">Select a story to review its letters.</div>
        )}
      </div>

      {editingStoryId && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <h3 className="text-sm font-bold text-violet-800 mb-3">Edit story</h3>
          <form onSubmit={handleSaveStoryEdit} className="grid gap-3 md:grid-cols-2">
            <input value={storyEditForm.title} onChange={(e) => setStoryEditForm({ ...storyEditForm, title: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Story title" />
            <select value={storyEditForm.status} onChange={(e) => setStoryEditForm({ ...storyEditForm, status: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm">
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PAUSED">PAUSED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
            <textarea value={storyEditForm.description} onChange={(e) => setStoryEditForm({ ...storyEditForm, description: e.target.value })} className="md:col-span-2 border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[90px]" placeholder="Description" />
            <input type="number" min="0.1" step="0.1" value={storyEditForm.assignmentWeight} onChange={(e) => setStoryEditForm({ ...storyEditForm, assignmentWeight: Number(e.target.value || 1) })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm" />
            <div className="md:col-span-2 flex flex-wrap gap-4 text-xs text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={storyEditForm.assignmentEnabled} onChange={(e) => setStoryEditForm({ ...storyEditForm, assignmentEnabled: e.target.checked })} /> enabled</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={storyEditForm.allowNewCustomers} onChange={(e) => setStoryEditForm({ ...storyEditForm, allowNewCustomers: e.target.checked })} /> new customers</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={storyEditForm.allowAfterCompletion} onChange={(e) => setStoryEditForm({ ...storyEditForm, allowAfterCompletion: e.target.checked })} /> after completion</label>
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="bg-violet-600 text-white rounded-xl px-3 py-2 text-sm font-semibold">Save story</button>
              <button type="button" onClick={() => { setEditingStoryId(null); setStoryEditForm(emptyStoryForm); }} className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-2 text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {editingLetterId && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <h3 className="text-sm font-bold text-emerald-800 mb-3">Edit letter</h3>
          <form onSubmit={handleSaveLetterEdit} className="grid gap-3 md:grid-cols-2">
            <input type="number" min="1" value={letterEditForm.sequenceNumber} onChange={(e) => setLetterEditForm({ ...letterEditForm, sequenceNumber: Number(e.target.value || 1) })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Sequence" />
            <select value={letterEditForm.status} onChange={(e) => setLetterEditForm({ ...letterEditForm, status: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm">
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PAUSED">PAUSED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
            <input value={letterEditForm.title} onChange={(e) => setLetterEditForm({ ...letterEditForm, title: e.target.value })} className="md:col-span-2 border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Letter title" />
            <input value={letterEditForm.summary} onChange={(e) => setLetterEditForm({ ...letterEditForm, summary: e.target.value })} className="md:col-span-2 border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Summary" />
            <textarea value={letterEditForm.continuitySummary} onChange={(e) => setLetterEditForm({ ...letterEditForm, continuitySummary: e.target.value })} className="md:col-span-2 border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[80px]" placeholder="Continuity summary" />
            <textarea value={letterEditForm.content} onChange={(e) => setLetterEditForm({ ...letterEditForm, content: e.target.value })} className="md:col-span-2 border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[120px]" placeholder="Content" />
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="bg-emerald-600 text-white rounded-xl px-3 py-2 text-sm font-semibold">Save letter</button>
              <button type="button" onClick={() => { setEditingLetterId(null); setLetterEditForm(emptyLetterForm); }} className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-2 text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {editingTemplateId && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <h3 className="text-sm font-bold text-sky-800 mb-3">Edit template</h3>
          <form onSubmit={handleSaveTemplateEdit} className="grid gap-3">
            <input value={templateEditForm.name} onChange={(e) => setTemplateEditForm({ ...templateEditForm, name: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Template name" />
            <textarea value={templateEditForm.description} onChange={(e) => setTemplateEditForm({ ...templateEditForm, description: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[70px]" placeholder="Description" />
            <div className="grid gap-3 md:grid-cols-2">
              <input type="number" min="0.1" step="0.1" value={templateEditForm.selectionWeight} onChange={(e) => setTemplateEditForm({ ...templateEditForm, selectionWeight: Number(e.target.value || 1) })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Weight" />
              <input type="number" min="1" value={templateEditForm.repetitionWindow} onChange={(e) => setTemplateEditForm({ ...templateEditForm, repetitionWindow: Number(e.target.value || 3) })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm" placeholder="Window" />
            </div>
            <textarea value={templateEditForm.body} onChange={(e) => setTemplateEditForm({ ...templateEditForm, body: e.target.value })} className="border border-slate-300 rounded-xl px-3 py-2 text-sm min-h-[170px] font-mono" placeholder="Template body" />
            <div className="flex gap-2">
              <button type="submit" className="bg-sky-600 text-white rounded-xl px-3 py-2 text-sm font-semibold">Save template</button>
              <button type="button" onClick={() => { setEditingTemplateId(null); setTemplateEditForm(emptyTemplateForm); }} className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-2 text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
};

export default StoryLetterLibrary;
