import { z } from "zod";
import { podeEmAlguma } from "@/lib/permissoes";
import { buscarOfertas } from "@/lib/compras/comparador";
import type { CopilotoTool } from "../tipos";

const inputSchema = z.object({
  produto: z.string().min(2).max(120),
});

type Input = z.infer<typeof inputSchema>;

export const compararFornecedoresTool: CopilotoTool<Input> = {
  name: "compararFornecedores",
  kind: "query",
  description:
    "Compara o preço do mesmo produto entre os fornecedores cadastrados (tabelas de preço " +
    "sincronizadas), do mais barato para o mais caro. Use para perguntas como 'qual fornecedor " +
    "está mais barato/caro em [produto]' ou 'qual a melhor oferta de [produto]'. Busca por " +
    "descrição, EAN ou código do fornecedor — não precisa ser o nome exato do produto cadastrado.",
  inputSchema,
  handler: async (input, ctx) => {
    if (!podeEmAlguma(ctx.tenant.acessos, "compras.ver")) {
      return { ok: false, erro: "Sem permissão para ver compras." };
    }
    const ofertas = await buscarOfertas(input.produto, 20);
    return {
      ok: true,
      conteudo: {
        termo: input.produto,
        ofertas: ofertas.map((o) => ({
          fornecedor: o.supplierNome,
          descricao: o.descricao,
          unidade: o.unidade,
          preco: o.preco,
          precoEfetivo: o.precoEfetivo,
          emPromocao: o.emPromocao,
          quantidadeMinima: o.quantidadeMinima,
        })),
      },
    };
  },
};
