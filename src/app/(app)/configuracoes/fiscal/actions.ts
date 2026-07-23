"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { onlyDigits } from "@/lib/normalize";
import { providerDoTenant, CRT_POR_REGIME } from "@/lib/fiscal";

// ============================================================
// Configurações fiscais. Duas permissões distintas de propósito:
// mexer aqui é `fiscal.configurar` (certificado, série, credencial), não
// `config.gerenciar` — quem cuida do cadastro da loja não necessariamente
// responde pelo CNPJ.
// ============================================================

async function tx<T>(fn: (tid: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("fiscal.configurar");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id));
}

const ROTA = "/configuracoes/fiscal";

/** Token colado do painel costuma vir com espaço, quebra de linha ou "Bearer ". */
function limparToken(token: string): string {
  return token.replace(/\s+/g, "").replace(/^bearer/i, "");
}

// ── Provedor ────────────────────────────────────────────────

const provedorSchema = z.object({
  provider: z.enum(["NUVEM_FISCAL", "PLUGNOTAS", "FOCUS", "TECNOSPEED", "SIMULADO"]),
  ambiente: z.enum(["PRODUCAO", "HOMOLOGACAO"]),
  /** Vazio no update = mantém o token já salvo (nunca devolvemos ele à tela). */
  apiToken: z.string().optional().default(""),
  webhookSecret: z.string().optional().default(""),
  ativo: z.boolean().default(false),
  emissaoAutomaticaNfce: z.boolean().default(false),
  prazoCancelamentoMin: z.coerce.number().int().min(0).max(10080).default(30),
});

export async function salvarProvedorFiscalAction(input: z.input<typeof provedorSchema>) {
  return tx(async (tid) => {
    const d = provedorSchema.parse(input);
    const atual = await db.fiscalConfig.findFirst({
      select: { id: true, apiToken: true, webhookSecret: true },
    });

    const apiToken = limparToken(d.apiToken) || atual?.apiToken || null;
    if (d.provider !== "SIMULADO" && !apiToken) {
      throw new Error("Informe o token de API do provedor fiscal.");
    }
    const webhookSecret = d.webhookSecret.trim() || atual?.webhookSecret || null;

    const dados = {
      provider: d.provider,
      ambiente: d.ambiente,
      apiToken,
      webhookSecret,
      ativo: d.ativo,
      emissaoAutomaticaNfce: d.emissaoAutomaticaNfce,
      prazoCancelamentoMin: d.prazoCancelamentoMin,
    };

    if (atual) {
      await db.fiscalConfig.update({ where: { id: atual.id }, data: dados });
    } else {
      await db.fiscalConfig.create({ data: { tenantId: tid, ...dados } });
    }
    revalidatePath(ROTA);
  });
}

/** Testa a credencial sem salvar. Nunca devolve o token de volta. */
export async function testarProvedorFiscalAction() {
  return tx(async (tid) => {
    const provider = await providerDoTenant(tid, { exigirAtivo: false });
    if (!provider.validarCredenciais) {
      throw new Error("Este provedor não oferece teste de credencial.");
    }
    await provider.validarCredenciais();
    return { ok: true as const };
  });
}

// ── Emitente (por loja) ─────────────────────────────────────

const emitenteSchema = z.object({
  siteId: z.string().min(1),
  cnpj: z.string().transform(onlyDigits).refine((v) => v.length === 14, "CNPJ deve ter 14 dígitos."),
  razaoSocial: z.string().trim().min(1, "Informe a razão social."),
  nomeFantasia: z.string().trim().optional().default(""),
  ie: z.string().trim().min(1, "Informe a inscrição estadual (ou ISENTO)."),
  im: z.string().trim().optional().default(""),
  cnae: z.string().trim().optional().default(""),
  regime: z.enum(["SIMPLES_NACIONAL", "SIMPLES_EXCESSO", "REGIME_NORMAL"]),
  cep: z.string().transform(onlyDigits).refine((v) => v.length === 8, "CEP deve ter 8 dígitos."),
  logradouro: z.string().trim().min(1, "Informe o logradouro."),
  numero: z.string().trim().min(1, "Informe o número."),
  complemento: z.string().trim().optional().default(""),
  bairro: z.string().trim().min(1, "Informe o bairro."),
  municipio: z.string().trim().min(1, "Informe o município."),
  codigoMunicipio: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v.length === 7, "Código IBGE do município deve ter 7 dígitos."),
  uf: z.string().trim().length(2, "UF deve ter 2 letras.").toUpperCase(),
  telefone: z.string().transform(onlyDigits).optional().default(""),
  cscId: z.string().trim().optional().default(""),
  csc: z.string().trim().optional().default(""),
  naturezaOperacaoPadrao: z.string().trim().min(1).default("Venda de mercadoria"),
});

export async function salvarEmitenteAction(input: z.input<typeof emitenteSchema>) {
  return tx(async (tid) => {
    const d = emitenteSchema.parse(input);
    const atual = await db.fiscalEmitente.findFirst({
      where: { siteId: d.siteId },
      select: { id: true, csc: true },
    });

    const dados = {
      cnpj: d.cnpj,
      razaoSocial: d.razaoSocial,
      nomeFantasia: d.nomeFantasia || null,
      ie: d.ie,
      im: d.im || null,
      cnae: d.cnae || null,
      regime: d.regime,
      cep: d.cep,
      logradouro: d.logradouro,
      numero: d.numero,
      complemento: d.complemento || null,
      bairro: d.bairro,
      municipio: d.municipio,
      codigoMunicipio: d.codigoMunicipio,
      uf: d.uf,
      telefone: d.telefone || null,
      cscId: d.cscId || null,
      // CSC é segredo: campo em branco mantém o que já está salvo.
      csc: d.csc || atual?.csc || null,
      naturezaOperacaoPadrao: d.naturezaOperacaoPadrao,
    };

    if (atual) {
      await db.fiscalEmitente.update({ where: { id: atual.id }, data: dados });
    } else {
      await db.fiscalEmitente.create({ data: { tenantId: tid, siteId: d.siteId, ...dados } });
    }
    revalidatePath(ROTA);
    return { aviso: await espelharEmitenteNoProvedor(tid, d) };
  });
}

/**
 * Provedores reais só aceitam certificado e nota de CNPJ já cadastrado como
 * empresa. Espelhamos aqui, mas o cadastro local não pode falhar por causa
 * disso — o operador salva os dados e resolve a credencial depois.
 */
async function espelharEmitenteNoProvedor(
  tenantId: string,
  d: z.output<typeof emitenteSchema>,
): Promise<string | undefined> {
  try {
    const provider = await providerDoTenant(tenantId, { exigirAtivo: false });
    if (!provider.sincronizarEmpresa) return undefined;

    const tenant = await db.tenant.findFirst({ select: { emailContato: true } });
    const email = tenant?.emailContato?.trim();
    if (!email) {
      return "Dados salvos, mas o provedor exige um e-mail de contato. Preencha em Configurações → Empresa.";
    }

    await provider.sincronizarEmpresa({
      emitente: {
        cnpj: d.cnpj,
        razaoSocial: d.razaoSocial,
        nomeFantasia: d.nomeFantasia || null,
        ie: d.ie,
        im: d.im || null,
        crt: CRT_POR_REGIME[d.regime],
        cep: d.cep,
        logradouro: d.logradouro,
        numero: d.numero,
        complemento: d.complemento || null,
        bairro: d.bairro,
        municipio: d.municipio,
        codigoMunicipio: d.codigoMunicipio,
        uf: d.uf,
        telefone: d.telefone || null,
        certificadoId: null,
        cscId: d.cscId || null,
        csc: d.csc || null,
      },
      email,
    });
    return undefined;
  } catch (e) {
    return `Dados salvos, mas o provedor não aceitou o cadastro: ${
      e instanceof Error ? e.message : "erro desconhecido"
    }`;
  }
}

// ── Certificado A1 ──────────────────────────────────────────

const certificadoSchema = z.object({
  siteId: z.string().min(1),
  /** .pfx/.p12 em base64. Certificado A1 tem poucos KB. */
  arquivoBase64: z.string().min(1, "Escolha o arquivo do certificado."),
  senha: z.string().min(1, "Informe a senha do certificado."),
});

/**
 * Sobe o certificado para o PROVEDOR. A senha e o .pfx passam por aqui e
 * morrem aqui: guardamos só o id opaco, o titular e a validade. Chave privada
 * não fica no nosso banco — se vazar o banco, não vaza a assinatura.
 */
export async function enviarCertificadoAction(input: z.input<typeof certificadoSchema>) {
  return tx(async (tid) => {
    const d = certificadoSchema.parse(input);

    const emitente = await db.fiscalEmitente.findFirst({
      where: { siteId: d.siteId },
      select: { id: true, cnpj: true },
    });
    if (!emitente) {
      throw new Error("Cadastre os dados fiscais desta loja antes de enviar o certificado.");
    }

    const provider = await providerDoTenant(tid, { exigirAtivo: false });
    const info = await provider.enviarCertificado({
      cnpj: emitente.cnpj,
      arquivo: Uint8Array.from(Buffer.from(d.arquivoBase64, "base64")),
      senha: d.senha,
    });

    if (onlyDigits(info.cnpj) !== emitente.cnpj) {
      throw new Error(
        `O certificado é do CNPJ ${info.cnpj}, diferente do cadastrado nesta loja.`,
      );
    }

    await db.fiscalEmitente.update({
      where: { id: emitente.id },
      data: {
        certificadoId: info.id,
        certificadoTitular: info.titular,
        certificadoValidade: info.validade,
      },
    });
    revalidatePath(ROTA);
    return { titular: info.titular, validade: info.validade };
  });
}

// ── Séries de numeração ─────────────────────────────────────

const serieSchema = z.object({
  siteId: z.string().min(1),
  modelo: z.enum(["NFCE", "NFE"]),
  serie: z.coerce.number().int().min(1).max(999),
  proximoNumero: z.coerce.number().int().min(1).max(999_999_999),
  ativa: z.boolean().default(true),
});

/**
 * Criar/ajustar série. O número inicial só pode SUBIR: baixar reemitiria
 * números já usados e a SEFAZ devolve duplicidade — erro que custa caro e
 * não tem desfazer.
 */
export async function salvarSerieAction(input: z.input<typeof serieSchema>) {
  return tx(async (tid) => {
    const d = serieSchema.parse(input);
    const atual = await db.fiscalSerie.findFirst({
      where: { siteId: d.siteId, modelo: d.modelo, serie: d.serie },
      select: { id: true, proximoNumero: true },
    });

    if (atual) {
      if (d.proximoNumero < atual.proximoNumero) {
        throw new Error(
          `O próximo número não pode voltar para ${d.proximoNumero}: a série já chegou em ${atual.proximoNumero}. Números repetidos são rejeitados pela SEFAZ.`,
        );
      }
      await db.fiscalSerie.update({
        where: { id: atual.id },
        data: { proximoNumero: d.proximoNumero, ativa: d.ativa },
      });
    } else {
      await db.fiscalSerie.create({
        data: {
          tenantId: tid,
          siteId: d.siteId,
          modelo: d.modelo,
          serie: d.serie,
          proximoNumero: d.proximoNumero,
          ativa: d.ativa,
        },
      });
    }
    revalidatePath(ROTA);
  });
}
