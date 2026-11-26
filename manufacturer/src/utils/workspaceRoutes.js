const hasPathPrefix = (pathname, prefix) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const standaloneDistributorPrefixes = ["/deliveries", "/demand", "/finance", "/paper-bills"];

export const isMixedPortalBuild = (baseUrl) => baseUrl !== "/";

export const getWorkspaceBasePath = (baseUrl, pathname) => {
  if (!isMixedPortalBuild(baseUrl)) return "/";
  if (hasPathPrefix(pathname, "/distributor")) return "/distributor";
  if (hasPathPrefix(pathname, "/manufacturer")) return "/manufacturer";
  return baseUrl.replace(/\/$/, "");
};

export const getDistributorPath = (baseUrl, path) =>
  isMixedPortalBuild(baseUrl)
    ? path
    : standaloneDistributorPrefixes.some((prefix) => hasPathPrefix(path, prefix))
      ? `/distributor${path}`
      : path;

export const getDistributorHomePath = (baseUrl) =>
  isMixedPortalBuild(baseUrl) ? "/" : "/distributor";

export const getWorkspaceHomePath = (baseUrl, workspace) => {
  if (!isMixedPortalBuild(baseUrl)) {
    return workspace === "DISTRIBUTOR" ? "/distributor" : "/";
  }
  return workspace === "DISTRIBUTOR" ? "/distributor" : "/manufacturer";
};
