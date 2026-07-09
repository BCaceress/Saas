import type { ComodatoAssetStatus } from "@/generated/prisma";

/** Equipamento serializado + empréstimo aberto (se houver). */
export type AssetRow = {
  id: string;
  nome: string;
  identificacao: string;
  status: ComodatoAssetStatus;
  valorEstimado: number | null;
  observacao: string | null;
  createdAt: string; // ISO
  loanAtual: {
    loanId: string;
    customerId: string;
    customerNome: string;
    emprestadoEm: string; // ISO
    previsaoDevolucao: string | null; // ISO
  } | null;
};

/** Tipo de vasilhame + total em campo (Σ saldos dos clientes). */
export type ContainerTypeRow = {
  id: string;
  nome: string;
  valorUnitario: number | null;
  ativo: boolean;
  totalEmCampo: number;
};

/** Saldo de vasilhames de um cliente por tipo (só saldo ≠ 0). */
export type ContainerBalanceRow = {
  customerId: string;
  customerNome: string;
  containerTypeId: string;
  containerTypeNome: string;
  saldo: number;
  ultimaMovimentacao: string; // ISO
};

export type CustomerOption = { id: string; nome: string };
