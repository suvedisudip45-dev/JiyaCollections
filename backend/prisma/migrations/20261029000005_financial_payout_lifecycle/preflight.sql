SELECT 'FinancialAccount.currentBalance' AS source, id AS recordId, currentBalance AS amount
FROM FinancialAccount
WHERE ABS(currentBalance - ROUND(currentBalance, 2)) > 0.000001
   OR ABS(currentBalance) > 999999999999999999.99
   OR currentBalance < 0
UNION ALL
SELECT 'CashTransaction.amount', id, amount
FROM CashTransaction
WHERE ABS(amount - ROUND(amount, 2)) > 0.000001
   OR ABS(amount) > 999999999999999999.99
UNION ALL
SELECT 'AccountPayable.totalAmount', id, totalAmount
FROM AccountPayable
WHERE ABS(totalAmount - ROUND(totalAmount, 2)) > 0.000001
   OR ABS(totalAmount) > 999999999999999999.99
UNION ALL
SELECT 'AccountPayable.paidAmount', id, paidAmount
FROM AccountPayable
WHERE ABS(paidAmount - ROUND(paidAmount, 2)) > 0.000001
   OR ABS(paidAmount) > 999999999999999999.99
UNION ALL
SELECT 'AccountPayable.remainingBalance', id, remainingBalance
FROM AccountPayable
WHERE ABS(remainingBalance - ROUND(remainingBalance, 2)) > 0.000001
   OR ABS(remainingBalance) > 999999999999999999.99
UNION ALL
SELECT 'AccountReceivable.totalAmount', id, totalAmount
FROM AccountReceivable
WHERE ABS(totalAmount - ROUND(totalAmount, 2)) > 0.000001
   OR ABS(totalAmount) > 999999999999999999.99
UNION ALL
SELECT 'AccountReceivable.receivedAmount', id, receivedAmount
FROM AccountReceivable
WHERE ABS(receivedAmount - ROUND(receivedAmount, 2)) > 0.000001
   OR ABS(receivedAmount) > 999999999999999999.99
UNION ALL
SELECT 'AccountReceivable.remainingBalance', id, remainingBalance
FROM AccountReceivable
WHERE ABS(remainingBalance - ROUND(remainingBalance, 2)) > 0.000001
   OR ABS(remainingBalance) > 999999999999999999.99;
