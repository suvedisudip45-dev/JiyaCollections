import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const LABELS = {
  dashboard: "Dashboard",
  campaigns: "Campaigns",
  cards: "Cards",
  redemptions: "Redemptions",
  "qr-validator": "QR Validator",
  reports: "Reports",
  collaborations: "Collaborations",
  profile: "Profile",
  settings: "Settings",
};

const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = [{ label: "Home", to: "/dashboard" }];
  let path = "";

  segments.forEach((segment, index) => {
    path += `/${segment}`;
    crumbs.push({
      label: LABELS[segment] || (index === segments.length - 1 ? "Details" : segment.replaceAll("-", " ")),
      to: path,
    });
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-xs capitalize text-[var(--mp-muted)]">
      {crumbs.map((crumb, index) => (
        <span key={crumb.to} className="inline-flex items-center gap-1.5">
          {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-[var(--mp-line)]" />}
          {index === crumbs.length - 1 ? (
            <span aria-current="page" className="font-semibold text-[var(--mp-ink)]">{crumb.label}</span>
          ) : (
            <Link to={crumb.to} className="hover:text-[var(--mp-ink)] hover:underline">{crumb.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
};

export default Breadcrumbs;
