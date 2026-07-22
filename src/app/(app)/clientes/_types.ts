import type { Sexo, IndicadorIE } from "@/generated/prisma";

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
  email: string | null;
  /**
   * Fiscal — exigido só na NF-e (modelo 55). Na NFC-e o CPF basta, e mesmo ele
   * é opcional. Vem quase sempre vazio no mercadinho.
   */
  cnpj: string | null;
  razaoSocial: string | null;
  ie: string | null;
  indicadorIE: IndicadorIE | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  codigoMunicipio: string | null;
  uf: string | null;
  /** Total gasto acumulado (para tier + ordenação) — vem agregado das vendas. */
  totalGasto: number;
  /** Data da última compra (ISO) ou null. */
  ultimaCompra: string | null;
};

export type ProdutoFavorito = { nome: string; vezes: number };

/** Compras de um mesmo dia, agrupadas para a lista "Comprados recentemente". */
export type ComprasPorDia = { data: string; itens: ProdutoFavorito[] };

/** Métricas ao vivo do cliente — derivadas de Sale/SaleItem. */
export type CustomerInsights = {
  totalGasto: number;
  ticketMedio: number;
  visitas: number;
  visitasMes: number;
  /** Visitas no mês anterior — só para comparação (0 se não houver). */
  visitasMesAnterior: number;
  ultimaCompra: string | null;
  valorUltimaCompra: number | null;
  diasSemComprar: number | null;
  /** Gasto no mês corrente. */
  gastoMes: number;
  /** Gasto no mês anterior — null quando não há histórico para comparar. */
  gastoMesAnterior: number | null;
  /** Intervalo médio (dias) entre compras — null com menos de 2 compras. */
  frequenciaMediaDias: number | null;
  comprasRecentes: ComprasPorDia[];
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
