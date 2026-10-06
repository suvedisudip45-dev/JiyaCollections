import { Link } from "react-router-dom";

const NotFound = () => (
  <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#d85b3f]">404 · Page not found</p>
    <h1 className="mt-3 text-3xl font-bold text-[#171717]">This admin page is not here.</h1>
    <p className="mt-2 text-sm text-[#6f6d68]">The link may be outdated, or you may not have reached the right destination.</p>
    <Link to="/orders" className="mt-6 rounded-lg bg-[#171717] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#333]">
      Return to orders
    </Link>
  </main>
);

export default NotFound;
