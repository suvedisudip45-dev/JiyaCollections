import { useContext } from "react";
import Title from "../components/Title";
import { assets } from "../assets/assets";
import { ShopContext } from "../context/ShopContext";

const renderParagraphs = (text, className = "") => String(text || "")
  .split(/\r?\n\s*\r?\n/)
  .filter((paragraph) => paragraph.trim())
  .map((paragraph, index) => (
    <p className={`whitespace-pre-line ${className}`} key={index}>{paragraph}</p>
  ));

const About = () => {
  const { storefrontContent } = useContext(ShopContext);
  const aboutPage = storefrontContent?.aboutPage || {};
  const description = String(aboutPage.description || "").trim();
  const missionDescription = String(aboutPage.missionDescription || "").trim();
  const whyCards = (aboutPage.whyCards || []).filter((card) => String(card.description || "").trim());

  return (
    <div>
      <div className="border-t pt-8 text-center text-2xl">
        <Title text1={aboutPage.title || "About Us"} />
      </div>

      {(description || missionDescription) && (
        <div className="my-10 flex flex-col gap-8 md:flex-row md:gap-16">
          <img
            className="w-full object-cover md:max-w-[450px]"
            src={aboutPage.image || assets.about_img}
            alt={aboutPage.title || "About our store"}
          />
          <div className="flex flex-col justify-center gap-6 text-gray-600 md:w-2/4">
            {description && renderParagraphs(description)}
            {missionDescription && (
              <>
                <b className="text-gray-800">{aboutPage.missionTitle || "Our Mission"}</b>
                {renderParagraphs(missionDescription)}
              </>
            )}
          </div>
        </div>
      )}

      {whyCards.length > 0 && (
        <>
          <div className="py-4 text-xl">
            <Title text1={aboutPage.whyTitle || "Why Choose Us"} />
          </div>
          <div className="mb-20 grid grid-cols-1 text-sm md:grid-cols-3">
            {whyCards.map((card, index) => (
              <div className="flex flex-col gap-5 border px-10 py-8 md:px-12 sm:py-20" key={`${card.title}-${index}`}>
                <b>{card.title}</b>
                {renderParagraphs(card.description, "text-gray-600")}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default About;
