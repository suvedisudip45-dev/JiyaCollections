export const MIXED_PORTALS = Object.freeze([
  Object.freeze({ packageName: "admin", outputDirectory: "admin", basePath: "/admin/", prefixes: ["/admin"] }),
  Object.freeze({ packageName: "manufacturer", outputDirectory: "manufacturer", basePath: "/manufacturer/", prefixes: ["/manufacturer", "/distributor"] }),
  Object.freeze({ packageName: "marketing", outputDirectory: "marketing", basePath: "/marketing/", prefixes: ["/marketing"] }),
]);

export const resolveSpaEntryForPath = (pathname) => {
  if (pathname === "/") return "/index.html";

  const portal = MIXED_PORTALS.find(({ prefixes }) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );

  return portal ? `/${portal.outputDirectory}/index.html` : "/404.html";
};
