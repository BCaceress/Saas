import type { Sexo } from "@/generated/prisma";

export type CustomerRow = {
  id: string;
  nome: string;
  cpf: string | null;
  dataNascimento: string | null; // ISO (date)
  sexo: Sexo | null;
  whatsapp: string | null; // só dígitos
  pontos: number;
  ativo: boolean;
  createdAt: string; // ISO
  /** Total gasto acumulado (para tier + ordenação) — vem agregado das vendas. */
  totalGasto: number;
  /** Data da última compra (ISO) ou null. */
  ultimaCompra: string | null;
};

export type ProdutoFavorito = { nome: string; vezes: number };

/** Métricas ao vivo do cliente — derivadas de Sale/SaleItem. */
export type CustomerInsights = {
  totalGasto: number;
  ticketMedio: number;
  visitas: number;
  visitasMes: number;
  ultimaCompra: string | null;
  diasSemComprar: number | null;
  produtosFavoritos: ProdutoFavorito[];
};

export type CouponReasonUI = "RISCO" | "ANIVERSARIO";

/** Candidato a cupom mostrado na aba de inteligência / alertas. */
export type CouponCandidate = {
  customerId: string;
  nome: string;
  whatsapp: string | null;
  tipo: CouponReasonUI;
  /** Só RISCO: dias sem comprar. */
  dias?: number;
  /** Só ANIVERSARIO: dd/mm. */
  aniversario?: string;
  /** Já recebeu cupom desse tipo nos últimos dias. */
  jaEnviado: boolean;
};
