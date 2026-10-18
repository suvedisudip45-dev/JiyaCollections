/* eslint-disable no-unused-vars */
import React from "react";

const NewsletterBox = () => {
  const onSubmitHandler = (event) => {
    event.preventDefault();
  };

  return (
    <section className="storefront-section py-10 text-center sm:py-12 lg:py-16">
      <p className="text-xl font-medium text-gray-800 sm:text-2xl">
        Subsribe now & get 20% off
      </p>
      <p className="mt-2 text-xs text-gray-400 sm:mt-3 sm:text-sm">
        OFFER VALID FOR THE NEXT 4 HOURS ONLY!
      </p>
      <form
        onSubmit={onSubmitHandler}
        className="mx-auto my-5 flex w-full max-w-2xl flex-col gap-2 border border-[var(--line)] p-2 sm:my-6 sm:flex-row sm:items-center sm:gap-3 sm:p-2"
      >
        <input
          className="min-h-11 w-full min-w-0 flex-1 bg-white px-3 outline-none"
          type="email"
          placeholder="Enter your email"
          required
        />
        <button
          type="submit"
          className="min-h-11 w-full shrink-0 bg-black px-6 py-3 text-xs text-white sm:w-auto sm:px-8"
        >
          SUBSCRIBE
        </button>
      </form>
    </section>
  );
};

export default NewsletterBox;
