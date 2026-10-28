type LotRow = {
  id: number; label: string; floor: string; unitShare: string; relationShare: string;
  relationId: number; relationType: string; quarterlyCall: string | null; balance: string | null;
};

/** Never copy the financial data of another relation on the same physical lot. */
export const serializeResidentLots = (rows: LotRow[], canReadFinance: boolean) => {
  const lots = new Map<number, any>();
  for (const row of rows) {
    const lot = lots.get(row.id) ?? { id: row.id, unitLabel: row.label, floor: row.floor, relationTypes: [] };
    if (!lot.relationTypes.includes(row.relationType)) lot.relationTypes.push(row.relationType);
    if (canReadFinance && row.relationType === "owner") {
      lot.shareLabel = row.relationShare || row.unitShare;
      lot.quarterlyCall = row.quarterlyCall === null ? null : Number(row.quarterlyCall);
      lot.balance = row.balance === null ? null : Number(row.balance);
    }
    lots.set(row.id, lot);
  }
  return [...lots.values()];
};
