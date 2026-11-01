/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const StorefrontContentSettings = ({ token }) => {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState(null);
  const fileInputs = useRef([]);
  const aboutImageInput = useRef(null);
  const logoImageInput = useRef(null);

  useEffect(() => {
    let mounted = true;
    axios.get(`${backendUrl}/api/storefront-content`)
      .then((response) => {
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load storefront content.");
        if (mounted) setContent(response.data.content);
      })
      .catch((error) => {
        toast.error(error.response?.data?.message || error.message || "Unable to load storefront content.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const updateAnnouncement = (field, value) => {
    setContent((current) => ({ ...current, [field]: value }));
  };

  const updateBenefit = (index, field, value) => {
    setContent((current) => ({
      ...current,
      benefits: current.benefits.map((benefit, benefitIndex) => (
        benefitIndex === index ? { ...benefit, [field]: value } : benefit
      )),
    }));
  };

  const updateAboutPage = (field, value) => {
    setContent((current) => ({
      ...current,
      aboutPage: { ...current.aboutPage, [field]: value },
    }));
  };

  const updateWhyCard = (index, field, value) => {
    setContent((current) => ({
      ...current,
      aboutPage: {
        ...current.aboutPage,
        whyCards: current.aboutPage.whyCards.map((card, cardIndex) => (
          cardIndex === index ? { ...card, [field]: value } : card
        )),
      },
    }));
  };

  const updateTerms = (field, value) => {
    setContent((current) => ({
      ...current,
      termsAndConditions: { ...current.termsAndConditions, [field]: value },
    }));
  };

  const updateTermCondition = (index, field, value) => {
    setContent((current) => ({
      ...current,
      termsAndConditions: {
        ...current.termsAndConditions,
        conditions: current.termsAndConditions.conditions.map((condition, conditionIndex) => (
          conditionIndex === index ? { ...condition, [field]: value } : condition
        )),
      },
    }));
  };

  const reorderTermCondition = (index, offset) => {
    setContent((current) => {
      const conditions = [...current.termsAndConditions.conditions];
      const targetIndex = index + offset;
      if (targetIndex < 0 || targetIndex >= conditions.length) return current;
      [conditions[index], conditions[targetIndex]] = [conditions[targetIndex], conditions[index]];
      return {
        ...current,
        termsAndConditions: { ...current.termsAndConditions, conditions },
      };
    });
  };

  const addTermCondition = () => {
    setContent((current) => ({
      ...current,
      termsAndConditions: {
        ...current.termsAndConditions,
        conditions: [...current.termsAndConditions.conditions, { title: "New condition", description: "" }],
      },
    }));
  };

  const removeTermCondition = (index) => {
    setContent((current) => ({
      ...current,
      termsAndConditions: {
        ...current.termsAndConditions,
        conditions: current.termsAndConditions.conditions.filter((_, conditionIndex) => conditionIndex !== index),
      },
    }));
  };

  const uploadImage = async (file, target, onUploaded) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    setUploadingTarget(target);
    try {
      const response = await axios.post(`${backendUrl}/api/storefront-content/upload-image`, formData, {
        headers: { token, "Content-Type": "multipart/form-data" },
      });
      if (!response.data?.success || !response.data.imageUrl) {
        throw new Error(response.data?.message || "Unable to upload the selected image.");
      }
      onUploaded(response.data.imageUrl);
      toast.success("Storefront image uploaded.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to upload the selected image.");
    } finally {
      setUploadingTarget(null);
      if (target === "logo") {
        if (logoImageInput.current) logoImageInput.current.value = "";
      } else if (target === "about") {
        if (aboutImageInput.current) aboutImageInput.current.value = "";
      } else {
        const index = Number(target.split("-")[1]);
        if (fileInputs.current[index]) fileInputs.current[index].value = "";
      }
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!content || saving) return;
    setSaving(true);
    try {
      const response = await axios.put(`${backendUrl}/api/storefront-content`, content, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to save storefront content.");
      setContent(response.data.content);
      toast.success("Storefront content saved.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to save storefront content.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-sm text-slate-500">Loading storefront content...</div>;
  if (!content) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Storefront content could not be loaded. Refresh the page to retry.</div>;

  return (
    <form onSubmit={save} className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Platform settings</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Storefront content</h1>
        <p className="mt-2 text-sm text-slate-600">Manage the storefront announcement, footer, About page, policy/benefit cards, and sign-up Terms &amp; Conditions from one place.</p>
      </header>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-bold text-slate-900">Storefront logo</h2>
          <p className="mt-1 text-xs text-slate-500">The selected logo is shared by the storefront header and footer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-48 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3">
            {content.logoImage
              ? <img src={content.logoImage} alt="Current storefront logo preview" className="max-h-full max-w-full object-contain" />
              : <span className="text-center text-xs text-slate-500">Bundled storefront logo is currently in use</span>}
          </div>
          <div>
            <input
              ref={logoImageInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Choose storefront logo image"
              onChange={(event) => uploadImage(
                event.target.files?.[0],
                "logo",
                (imageUrl) => updateAnnouncement("logoImage", imageUrl),
              )}
            />
            <button
              type="button"
              onClick={() => logoImageInput.current?.click()}
              disabled={uploadingTarget !== null}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploadingTarget === "logo" ? "Uploading..." : content.logoImage ? "Update logo" : "Upload logo"}
            </button>
            {content.logoImage && (
              <button
                type="button"
                onClick={() => updateAnnouncement("logoImage", "")}
                className="ml-2 text-xs font-semibold text-rose-600 hover:text-rose-700"
              >
                Use default logo
              </button>
            )}
            <p className="mt-1 text-[11px] text-slate-500">JPG, PNG or WebP; up to 10 MB. Save storefront content to publish the change.</p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-base font-bold text-slate-900">Announcement bar</h2>
        <label className="block text-sm font-semibold text-slate-700">
          First message
          <input
            value={content.announcementPrimary}
            onChange={(event) => updateAnnouncement("announcementPrimary", event.target.value)}
            maxLength={180}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Second message
          <input
            value={content.announcementSecondary}
            onChange={(event) => updateAnnouncement("announcementSecondary", event.target.value)}
            maxLength={180}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-bold text-slate-900">Footer content</h2>
          <p className="mt-1 text-xs text-slate-500">Update the store description and contact details displayed in the footer.</p>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          Basic description
          <textarea
            value={content.footerDescription}
            onChange={(event) => setContent((current) => ({ ...current, footerDescription: event.target.value }))}
            maxLength={5000}
            required
            rows={5}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            Contact phone
            <input
              type="tel"
              value={content.contactPhone}
              onChange={(event) => setContent((current) => ({ ...current, contactPhone: event.target.value }))}
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Contact email
            <input
              type="email"
              value={content.contactEmail}
              onChange={(event) => setContent((current) => ({ ...current, contactEmail: event.target.value }))}
              maxLength={254}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-bold text-slate-900">About page</h2>
          <p className="mt-1 text-xs text-slate-500">Control the image, headings, paragraphs, mission, and Why Choose Us cards shown on the About page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-32 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {content.aboutPage.image
              ? <img src={content.aboutPage.image} alt="" className="h-full w-full object-cover" />
              : <span className="text-xs text-slate-400">Default About image</span>}
          </div>
          <div>
            <input
              ref={aboutImageInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Choose About page image"
              onChange={(event) => uploadImage(
                event.target.files?.[0],
                "about",
                (imageUrl) => updateAboutPage("image", imageUrl),
              )}
            />
            <button
              type="button"
              onClick={() => aboutImageInput.current?.click()}
              disabled={uploadingTarget !== null}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploadingTarget === "about" ? "Uploading..." : "Select About image"}
            </button>
            {content.aboutPage.image && (
              <button
                type="button"
                onClick={() => updateAboutPage("image", "")}
                className="ml-2 text-xs font-semibold text-rose-600 hover:text-rose-700"
              >
                Use default
              </button>
            )}
            <p className="mt-1 text-[11px] text-slate-500">JPG, PNG or WebP; up to 10 MB.</p>
          </div>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          About heading
          <input
            value={content.aboutPage.title}
            onChange={(event) => updateAboutPage("title", event.target.value)}
            maxLength={100}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          About description
          <textarea
            value={content.aboutPage.description}
            onChange={(event) => updateAboutPage("description", event.target.value)}
            maxLength={10000}
            required
            rows={8}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">Use a blank line between paragraphs. Line breaks and whitespace are preserved on the page.</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            Mission heading
            <input
              value={content.aboutPage.missionTitle}
              onChange={(event) => updateAboutPage("missionTitle", event.target.value)}
              maxLength={100}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Why Choose Us heading
            <input
              value={content.aboutPage.whyTitle}
              onChange={(event) => updateAboutPage("whyTitle", event.target.value)}
              maxLength={100}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          Mission description
          <textarea
            value={content.aboutPage.missionDescription}
            onChange={(event) => updateAboutPage("missionDescription", event.target.value)}
            maxLength={5000}
            required
            rows={5}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">Use a blank line between paragraphs. Line breaks and whitespace are preserved on the page.</span>
        </label>
        <div className="grid gap-4 lg:grid-cols-3">
          {content.aboutPage.whyCards.map((card, index) => (
            <article key={index} className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-900">Why Choose Us card {index + 1}</h3>
              <label className="block text-sm font-semibold text-slate-700">
                Title
                <input
                  value={card.title}
                  onChange={(event) => updateWhyCard(index, "title", event.target.value)}
                  maxLength={100}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                Description
                <textarea
                  value={card.description}
                  onChange={(event) => updateWhyCard(index, "description", event.target.value)}
                  maxLength={2000}
                  required
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">Paragraph breaks and line breaks are preserved.</span>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-bold text-slate-900">Terms &amp; Conditions</h2>
          <p className="mt-1 text-xs text-slate-500">Manage the sign-up agreement text and its ordered conditions. Paragraph breaks and line spacing are retained.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            Modal heading
            <input
              value={content.termsAndConditions.title}
              onChange={(event) => updateTerms("title", event.target.value)}
              maxLength={120}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Subtitle
            <input
              value={content.termsAndConditions.subtitle}
              onChange={(event) => updateTerms("subtitle", event.target.value)}
              maxLength={240}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          Introductory notice
          <textarea
            value={content.termsAndConditions.notice}
            onChange={(event) => updateTerms("notice", event.target.value)}
            maxLength={2000}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">Line breaks and whitespace are preserved.</span>
        </label>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">Ordered conditions ({content.termsAndConditions.conditions.length})</h3>
            <button
              type="button"
              onClick={addTermCondition}
              disabled={content.termsAndConditions.conditions.length >= 50}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add condition
            </button>
          </div>
          {content.termsAndConditions.conditions.map((condition, index) => (
            <article key={index} className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900">Condition {index + 1}</h4>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => reorderTermCondition(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move condition ${index + 1} up`}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => reorderTermCondition(index, 1)}
                    disabled={index === content.termsAndConditions.conditions.length - 1}
                    aria-label={`Move condition ${index + 1} down`}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTermCondition(index)}
                    className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <label className="block text-sm font-semibold text-slate-700">
                Condition title
                <input
                  value={condition.title}
                  onChange={(event) => updateTermCondition(index, "title", event.target.value)}
                  maxLength={180}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                Condition details
                <textarea
                  value={condition.description}
                  onChange={(event) => updateTermCondition(index, "description", event.target.value)}
                  maxLength={10000}
                  required
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">Use blank lines to separate paragraphs; leading spaces and line breaks are preserved.</span>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Policy and benefit cards</h2>
          <p className="mt-1 text-xs text-slate-500">Choose a logo image and update the title and description for each card.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {content.benefits.map((benefit, index) => (
            <article key={index} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-slate-900">Card {index + 1}</h3>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {benefit.image
                    ? <img src={benefit.image} alt="" className="h-full w-full object-contain p-2" />
                    : <span className="text-xs text-slate-400">No image</span>}
                </div>
                <div>
                  <input
                    ref={(element) => { fileInputs.current[index] = element; }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label={`Choose image for benefit card ${index + 1}`}
                    onChange={(event) => uploadImage(
                      event.target.files?.[0],
                      `benefit-${index}`,
                      (imageUrl) => updateBenefit(index, "image", imageUrl),
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputs.current[index]?.click()}
                    disabled={uploadingTarget !== null}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {uploadingTarget === `benefit-${index}` ? "Uploading..." : "Select logo image"}
                  </button>
                  {benefit.image && (
                    <button
                      type="button"
                      onClick={() => updateBenefit(index, "image", "")}
                      className="ml-2 text-xs font-semibold text-rose-600 hover:text-rose-700"
                    >
                      Remove
                    </button>
                  )}
                  <p className="mt-1 text-[11px] text-slate-500">JPG, PNG or WebP; up to 10 MB.</p>
                </div>
              </div>
              <label className="block text-sm font-semibold text-slate-700">
                Title
                <input
                  value={benefit.title}
                  onChange={(event) => updateBenefit(index, "title", event.target.value)}
                  maxLength={80}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                Description
                <textarea
                  value={benefit.description}
                  onChange={(event) => updateBenefit(index, "description", event.target.value)}
                  maxLength={240}
                  required
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
              </label>
            </article>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || uploadingTarget !== null}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save storefront content"}
        </button>
      </div>
    </form>
  );
};

export default StorefrontContentSettings;
