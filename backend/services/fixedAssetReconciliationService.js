const TOLERANCE = 0.05;

const CONTROL_ACCOUNTS = [
  {
    accountCode: "1510",
    label: "Fixed asset cost",
    normalBalance: "DEBIT",
    balanceType: "GROSS_COST",
    categories: ["COMPUTERS_IT", "MACHINERY_EQUIPMENT", "LEASEHOLD_IMPROVEMENTS"],
  },
  {
    accountCode: "1520",
    label: "Furniture and fixtures",
    normalBalance: "DEBIT",
    balanceType: "GROSS_COST",
    categories: ["FURNITURE_FIXTURES"],
  },
  {
    accountCode: "1530",
    label: "Vehicles",
    normalBalance: "DEBIT",
    balanceType: "GROSS_COST",
    categories: ["VEHICLES"],
  },
  {
    accountCode: "1590",
    label: "Accumulated depreciation",
    normalBalance: "CREDIT",
    balanceType: "ACCUMULATED_DEPRECIATION",
    categories: [],
  },
];

const ASSET_ACCOUNT_BY_CATEGORY = new Map(
  CONTROL_ACCOUNTS
    .filter(({ balanceType }) => balanceType === "GROSS_COST")
    .flatMap(({ accountCode, categories }) => categories.map((category) => [category, accountCode])),
);

const round = (amount) => Number(Number(amount || 0).toFixed(2));

export const buildFixedAssetReconciliation = ({ assets = [], accounts = [] } = {}) => {
  const accountsByCode = new Map(accounts.map((account) => [String(account.accountCode), account]));
  const registerBalances = new Map(CONTROL_ACCOUNTS.map(({ accountCode }) => [
    accountCode,
    {
      grossCost: 0,
      accumulatedDepreciation: 0,
      currentBookValue: 0,
      assetCount: 0,
      bookMismatchCount: 0,
      unsupportedCategoryCount: 0,
    },
  ]));
  let activeAssetCount = 0;
  let inactiveAssetBookValueCount = 0;

  for (const asset of assets) {
    const currentBookValue = Number(asset.currentBookValue || 0);
    if (asset.status !== "ACTIVE") {
      if (Math.abs(currentBookValue) > TOLERANCE) inactiveAssetBookValueCount += 1;
      continue;
    }

    activeAssetCount += 1;
    const accountCode = ASSET_ACCOUNT_BY_CATEGORY.get(asset.category) || "1510";
    const balance = registerBalances.get(accountCode);
    const purchaseCost = Number(asset.purchaseCost || 0);
    const accumulatedDepreciation = Number(asset.accumulatedDepreciation || 0);
    const bookVariance = round(purchaseCost - accumulatedDepreciation - currentBookValue);
    const validBookValues = purchaseCost > 0
      && accumulatedDepreciation >= 0
      && currentBookValue >= 0
      && accumulatedDepreciation <= purchaseCost + TOLERANCE
      && currentBookValue <= purchaseCost + TOLERANCE;

    balance.grossCost += purchaseCost;
    balance.accumulatedDepreciation += accumulatedDepreciation;
    balance.currentBookValue += currentBookValue;
    balance.assetCount += 1;
    if (!validBookValues || Math.abs(bookVariance) > TOLERANCE) balance.bookMismatchCount += 1;
    if (!ASSET_ACCOUNT_BY_CATEGORY.has(asset.category)) balance.unsupportedCategoryCount += 1;
  }

  const assetRegisters = ["1510", "1520", "1530"].map((accountCode) => registerBalances.get(accountCode));
  const totalAccumulatedDepreciation = assetRegisters.reduce((sum, register) => sum + register.accumulatedDepreciation, 0);
  const totalCurrentBookValue = assetRegisters.reduce((sum, register) => sum + register.currentBookValue, 0);
  const totalAssetBookMismatchCount = assetRegisters.reduce((sum, register) => sum + register.bookMismatchCount, 0);
  const totalUnsupportedCategoryCount = assetRegisters.reduce((sum, register) => sum + register.unsupportedCategoryCount, 0);
  const controls = CONTROL_ACCOUNTS.map((control) => {
    const account = accountsByCode.get(control.accountCode);
    const register = control.balanceType === "GROSS_COST"
      ? registerBalances.get(control.accountCode)
      : {
        accumulatedDepreciation: totalAccumulatedDepreciation,
        assetCount: activeAssetCount,
        bookMismatchCount: 0,
        unsupportedCategoryCount: 0,
      };
    const registerBalance = control.balanceType === "GROSS_COST"
      ? register.grossCost
      : register.accumulatedDepreciation;
    const glBalance = Number(account?.currentBalance || 0);
    const variance = round(glBalance - registerBalance);
    const accountMappingMatches = String(account?.normalBalance || "").toUpperCase() === control.normalBalance;
    const isReconciled = Boolean(account)
      && accountMappingMatches
      && Math.abs(variance) <= TOLERANCE
      && register.bookMismatchCount === 0
      && register.unsupportedCategoryCount === 0;

    return {
      accountCode: control.accountCode,
      label: control.label,
      balanceType: control.balanceType,
      categories: control.categories,
      normalBalance: control.normalBalance,
      accountExists: Boolean(account),
      accountMappingMatches,
      registerBalance: round(registerBalance),
      glBalance: round(glBalance),
      variance,
      assetCount: register.assetCount,
      bookMismatchCount: register.bookMismatchCount,
      unsupportedCategoryCount: register.unsupportedCategoryCount,
      isReconciled,
      status: isReconciled ? "MATCH" : "REVIEW",
    };
  });
  const grossCost = round(
    registerBalances.get("1510").grossCost
    + registerBalances.get("1520").grossCost
    + registerBalances.get("1530").grossCost,
  );
  const accumulatedDepreciation = round(
    totalAccumulatedDepreciation,
  );
  const netBookValue = round(grossCost - accumulatedDepreciation);
  const registerBookValue = round(totalCurrentBookValue);
  const controlUnmatchedCount = controls.filter((control) => !control.isReconciled).length;
  const unmatchedCount = controlUnmatchedCount + inactiveAssetBookValueCount;

  return {
    coverageStatus: "SOURCE_SCOPED",
    activeAssetCount,
    grossCost,
    accumulatedDepreciation,
    netBookValue: registerBookValue,
    bookValueVariance: round(netBookValue - registerBookValue),
    inactiveAssetBookValueCount,
    assetBookMismatchCount: totalAssetBookMismatchCount,
    unsupportedCategoryCount: totalUnsupportedCategoryCount,
    controlUnmatchedCount,
    unmatchedCount,
    isReconciled: unmatchedCount === 0,
    controls,
    coverageNote: "Compares active fixed-asset register cost and accumulated depreciation with GL controls using the current posting-engine category mapping. It is a current-balance tie-out only; physical existence, historical opening balances, tax basis, and depreciation-policy approval are not established.",
  };
};
