"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { cifrar } from "@/lib/crypto";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { onlyDigits } from "@/lib/normalize";
import { providerDoTenant, CRT_POR_REGIME } from "@/lib/fiscal";
import { lerCertificadoA1 } from "@/lib/fiscal/certificado-a1";
import { consultarCnpjReceita } from "@/lib/fiscal/cnpj-receita";

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
      // Credenciais de terceiro nunca ficam em claro no banco (lib/crypto).
      apiToken: cifrar(apiToken),
      webhookSecret: cifrar(webhookSecret),
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
      // CSC é segredo: campo em branco mantém o que já está salvo, e o valor
      // vai cifrado para o banco (lib/crypto).
      csc: cifrar(d.csc || atual?.csc || null),
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
 * Valida o certificado localmente e, quando houver provedor de emissão, também
 * o envia para ele. Para a Distribuição DF-e direta, o .pfx e a senha ficam
 * cifrados com SECRETS_KEY; nunca são devolvidos ao browser.
 */
export async function enviarCertificadoAction(input: z.input<typeof certificadoSchema>) {
  return tx(async (tid) => {
    const d = certificadoSchema.parse(input);

    const infoLocal = lerCertificadoA1(d.arquivoBase64, d.senha);
    const emitente =
      (await db.fiscalEmitente.findFirst({
        where: { siteId: d.siteId },
        select: { id: true, cnpj: true },
      })) ?? (await emitenteDoCertificado(tid, d.siteId, infoLocal.cnpj, infoLocal.titular));
    const config = await db.fiscalConfig.findFirst({
      select: { provider: true },
    });
    const info =
      config && config.provider !== "SIMULADO"
        ? await (await providerDoTenant(tid, { exigirAtivo: false })).enviarCertificado({
            cnpj: emitente.cnpj,
            arquivo: Uint8Array.from(Buffer.from(d.arquivoBase64, "base64")),
            senha: d.senha,
          })
        : infoLocal;

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
        certificadoPfx: cifrar(d.arquivoBase64),
        certificadoSenha: cifrar(d.senha),
        distribuicaoUltimoErro: null,
      },
    });
    revalidatePath(ROTA);
    revalidatePath("/configuracoes/notas-fiscais");
    return { titular: info.titular, validade: info.validade };
  });
}

/**
 * Loja sem dados fiscais: o certificado basta para receber nota pela SEFAZ.
 * O CNPJ sai do próprio certificado e o resto (razão social, endereço, UF) da
 * Receita, com o endereço da loja/empresa como reserva para a UF. A IE fica em
 * branco — só a emissão precisa dela, e a tela fiscal pede antes de emitir.
 */
async function emitenteDoCertificado(
  tenantId: string,
  siteId: string,
  cnpj: string,
  titular: string,
): Promise<{ id: string; cnpj: string }> {
  const outraLoja = await db.fiscalEmitente.findFirst({
    where: { cnpj },
    select: { site: { select: { nome: true } } },
  });
  if (outraLoja) {
    throw new Error(
      `O CNPJ ${cnpj} deste certificado já está vinculado à loja ${outraLoja.site.nome}.`,
    );
  }

  const [receita, site, tenant] = await Promise.all([
    consultarCnpjReceita(cnpj),
    db.site.findFirst({
      where: { id: siteId },
      select: { cep: true, rua: true, numero: true, cidade: true, estado: true },
    }),
    db.tenant.findFirst({ select: { estado: true, cidade: true } }),
  ]);
  if (!site) throw new Error("Loja não encontrada.");

  const uf = (receita?.uf || site.estado || tenant?.estado || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) {
    throw new Error(
      "Não conseguimos descobrir a UF deste CNPJ na Receita. Preencha o estado da loja em Configurações → Empresa e envie o certificado de novo.",
    );
  }

  return db.fiscalEmitente.create({
    data: {
      tenantId,
      siteId,
      cnpj,
      razaoSocial: receita?.razaoSocial || titular,
      nomeFantasia: receita?.nomeFantasia || null,
      ie: "",
      cep: receita?.cep || onlyDigits(site.cep ?? ""),
      logradouro: receita?.logradouro || site.rua || "",
      numero: receita?.numero || site.numero || "",
      complemento: receita?.complemento || null,
      bairro: receita?.bairro || "",
      municipio: receita?.municipio || site.cidade || tenant?.cidade || "",
      codigoMunicipio: receita?.codigoMunicipio || "",
      uf,
      telefone: receita?.telefone || null,
    },
    select: { id: true, cnpj: true },
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
