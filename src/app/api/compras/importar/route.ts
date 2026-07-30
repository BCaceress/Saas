import { NextResponse } from "next/server";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { ingerir } from "@/lib/compras/ingest";
import { kindPorArquivo } from "@/lib/compras/connectors";
import type { SupplierIntegrationKind } from "@/generated/prisma";

// ============================================================
// Upload da tabela do fornecedor.
//
// Route handler, e não Server Action, por causa do arquivo: planilha de
// distribuidor passa fácil do limite de corpo de uma action, e aqui o
// streaming do multipart resolve isso sem configuração extra.
// ============================================================

const TAMANHO_MAX = 25 * 1024 * 1024; // 25 MB

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await guardAction("fornecedor.editar");
  } catch (e) {
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : "Sem permissão." },
      { status: 403 },
    );
  }

  const form = await req.formData();
  const arquivo = form.get("arquivo");
  const supplierId = String(form.get("supplierId") ?? "");
  const tipoForcado = form.get("tipo") ? String(form.get("tipo")) : null;
  const substituir = form.get("substituir") !== "0";

  if (!supplierId) {
    return NextResponse.json({ erro: "Escolha o fornecedor." }, { status: 400 });
  }
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ erro: "Envie um arquivo." }, { status: 400 });
  }
  if (arquivo.size === 0) {
    return NextResponse.json({ erro: "O arquivo está vazio." }, { status: 400 });
  }
  if (arquivo.size > TAMANHO_MAX) {
    return NextResponse.json(
      { erro: "Arquivo maior que 25 MB. Divida a tabela ou envie em CSV." },
      { status: 413 },
    );
  }

  const kind =
    (tipoForcado as SupplierIntegrationKind | null) ??
    kindPorArquivo(arquivo.name, arquivo.type);

  if (!kind) {
    return NextResponse.json(
      { erro: "Formato não reconhecido. Aceito: xlsx, csv, pdf, xml, json, jpg ou png." },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());

  try {
    const resultado = await runWithTenant(ctx.tenant.id, () =>
      ingerir({
        supplierId,
        kind,
        origem: "manual",
        userId: ctx.user.id,
        substituirCatalogo: substituir,
        arquivo: { nome: arquivo.name, tamanho: arquivo.size, mimeType: arquivo.type },
        fonte: {
          tipo: "arquivo",
          nome: arquivo.name,
          mimeType: arquivo.type || "application/octet-stream",
          bytes,
        },
      }),
    );

    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : "Falha ao importar a tabela." },
      { status: 422 },
    );
  }
}
