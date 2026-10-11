import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const LABELS = {
  shop: "Shop",
  "combo-bundles": "Combo Bundles",
  collaborations: "Collaborations",
  about: "About",
  contact: "Contact",
  product: "Product",
  cart: "Cart",
  login: "Login",
  "place-order": "Checkout",
  orders: "My Orders",
  profile: "Profile",
  "marketing-cards": "Marketing Cards",
  verify: "Verify Account",
  wishlist: "Wishlist",
};

const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "login") return null;
  const crumbs = [{ label: "Home", to: "/" }];
  let path = "";

  segments.forEach((segment, index) => {
    path += `/${segment}`;
    crumbs.push({
      label: LABELS[segment] || (index === segments.length - 1 ? "Details" : segment.replaceAll("-", " ")),
      to: path,
    });
    if (segments.length === 0) crumbs[0].to = "";
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 pt-4 text-xs capitalize text-[#6f6d68]">
      {crumbs.map((crumb, index) => (
        <span key={crumb.to} className="inline-flex items-center gap-1.5">
          {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-[#aaa69e]" />}
          {index === crumbs.length - 1 ? (
            <span aria-current="page" className="font-semibold text-[#171717]">{crumb.label}</span>
          ) : (
            <Link to={crumb.to} className="hover:text-[#171717] hover:underline">{crumb.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
};

export default Breadcrumbs;
