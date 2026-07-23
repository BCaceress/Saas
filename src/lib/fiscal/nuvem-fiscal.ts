import "server-only";
import {
  FiscalProviderError,
  type ArquivoFiscal,
  type CertificadoInfo,
  type DestinatarioFiscal,
  type DocumentoParaEmitir,
  type EmitenteFiscal,
  type FiscalProvider,
  type ItemFiscal,
  type ResultadoEvento,
  type ResultadoFiscal,
  type StatusFiscal,
} from "./types";
import type { FiscalAmbiente, FiscalModelo } from "@/generated/prisma";

// ============================================================
// Adapter Nuvem Fiscal (Fase 6). Traduz o contrato FiscalProvider para a API
// REST deles — o resto do ERP não sabe que este arquivo existe.
//
// Três coisas que mudam de forma em relação ao simulado:
//   1. Credencial é OAuth2 client_credentials, não token estático. Guardamos
//      "clientId:clientSecret" em FiscalConfig.apiToken e trocamos por um
//      access_token de vida curta, cacheado em memória por processo.
//   2. O emitente precisa existir como "empresa" lá antes de emitir ou de
//      receber certificado — daí `sincronizarEmpresa`.
//   3. Rejeição da SEFAZ volta 200 com status "rejeitado". Só falha de
//      transporte/credencial vira FiscalProviderError (regra do contrato).
//
// O corpo da emissão é o leiaute da NF-e 4.00 com os nomes das tags em
// snake_case (ide.nat_op, prod.c_prod, …). Não "melhore" esses nomes.
// ============================================================

const API = "https://api.nuvemfiscal.com.br";
const AUTH = "https://auth.nuvemfiscal.com.br/oauth/token";
const SCOPES = "empresa nfe nfce";
const VERSAO_APP = "NoHub Market 1.0";

/** Brasil não tem horário de verão desde 2019 — offset fixo. */
const OFFSET_BR_MIN = -180;

type Ambiente = "producao" | "homologacao";

// ── Auth ────────────────────────────────────────────────────

type TokenCache = { token: string; expiraEm: number };
const tokens = new Map<string, TokenCache>();

/** apiToken guarda "clientId:clientSecret" — um campo só na configuração. */
function parseCredencial(apiToken: string | null): { id: string; secret: string } {
  const [id, ...resto] = (apiToken ?? "").split(":");
  const secret = resto.join(":");
  if (!id || !secret) {
    throw new FiscalProviderError(
      "Credencial da Nuvem Fiscal inválida. Informe no formato clientId:clientSecret.",
    );
  }
  return { id, secret };
}

async function accessToken(apiToken: string | null): Promise<string> {
  const { id, secret } = parseCredencial(apiToken);
  const cache = tokens.get(id);
  // 60s de folga: token que vence no meio da chamada vira 401 sem motivo.
  if (cache && cache.expiraEm - 60_000 > Date.now()) return cache.token;

  let res: Response;
  try {
    res = await fetch(AUTH, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
        scope: SCOPES,
      }),
      cache: "no-store",
    });
  } catch (e) {
    throw new FiscalProviderError("Não foi possível falar com a Nuvem Fiscal.", e);
  }

  if (!res.ok) {
    throw new FiscalProviderError(
      "Credencial da Nuvem Fiscal recusada. Confira o client ID e o client secret.",
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(id, {
    token: json.access_token,
    expiraEm: Date.now() + json.expires_in * 1000,
  });
  return json.access_token;
}

// ── HTTP ────────────────────────────────────────────────────

function mensagemDeErro(status: number, corpo: string): string {
  try {
    const j = JSON.parse(corpo) as { error?: { message?: string }; message?: string };
    const m = j.error?.message ?? j.message;
    if (m) return m;
  } catch {
    // corpo não-JSON: cai no genérico
  }
  return `Nuvem Fiscal respondeu ${status}.`;
}

/** Formato exigido pela SEFAZ: AAAA-MM-DDThh:mm:ss-03:00 (com fuso, nunca "Z"). */
function iso8601Br(d: Date): string {
  const local = new Date(d.getTime() + OFFSET_BR_MIN * 60_000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

const dt = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function fiscalNuvemProvider(cfg: {
  apiToken: string | null;
  ambiente: FiscalAmbiente;
}): FiscalProvider {
  const ambiente: Ambiente = cfg.ambiente === "PRODUCAO" ? "producao" : "homologacao";

  async function req<T>(
    metodo: string,
    caminho: string,
    opts: { body?: unknown; binario?: boolean } = {},
  ): Promise<T> {
    const token = await accessToken(cfg.apiToken);
    let res: Response;
    try {
      res = await fetch(`${API}${caminho}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${token}`,
          ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: "no-store",
      });
    } catch (e) {
      throw new FiscalProviderError("Não foi possível falar com a Nuvem Fiscal.", e);
    }

    if (!res.ok) {
      throw new FiscalProviderError(mensagemDeErro(res.status, await res.text().catch(() => "")));
    }
    if (opts.binario) {
      return {
        conteudo: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      } as T;
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  /** NFC-e e NF-e têm caminhos irmãos — só muda o prefixo. */
  const raiz = (modelo: FiscalModelo) => (modelo === "NFCE" ? "/nfce" : "/nfe");

  // ── Emissão ──────────────────────────────────────────────

  const TPAG: Record<DocumentoParaEmitir["pagamentos"][number]["forma"], string> = {
    DINHEIRO: "01",
    CHEQUE: "02",
    CARTAO_CREDITO: "03",
    CARTAO_DEBITO: "04",
    CREDITO_LOJA: "05",
    VALE_ALIMENTACAO: "10",
    VALE_REFEICAO: "11",
    PIX: "17",
    SEM_PAGAMENTO: "90",
    OUTROS: "99",
  };

  /** tBand da SEFAZ a partir da bandeira normalizada (lib/pagamentos). */
  const TBAND: Record<string, string> = {
    VISA: "01",
    MASTERCARD: "02",
    AMEX: "03",
    SOROCRED: "04",
    DINERS: "05",
    ELO: "06",
    HIPERCARD: "07",
    AURA: "08",
    CABAL: "09",
    OUTROS: "99",
  };

  /**
   * Grupo `card` (YA04a). Só tp_integra é obrigatório: 1 = valor foi à
   * maquininha pela nossa API, 2 = maquininha solta. Bandeira, CNPJ da
   * credenciadora e código de autorização entram SÓ quando o adquirente
   * devolveu — campo omitido é válido no schema, campo chutado é nota errada.
   */
  function grupoCartao(
    c: NonNullable<DocumentoParaEmitir["pagamentos"][number]["cartao"]>,
  ): Record<string, unknown> {
    const tBand = c.bandeira ? TBAND[c.bandeira] : null;
    return {
      card: {
        tp_integra: c.integrado ? 1 : 2,
        ...(c.credenciadoraCnpj ? { cnpj: c.credenciadoraCnpj } : {}),
        ...(tBand ? { t_band: tBand } : {}),
        ...(c.autorizacao ? { c_aut: c.autorizacao } : {}),
      },
    };
  }

  /**
   * ICMS do item. O grupo depende do CST/CSOSN — mandar o grupo errado é
   * rejeição na hora. Cobrimos os casos do varejo de mercadinho e falhamos
   * alto no resto: nota rejeitada em produção custa mais que um erro claro.
   */
  function icmsDoItem(i: ItemFiscal): Record<string, unknown> {
    const orig = Number(i.origem || 0);

    if (i.csosn) {
      const base = { orig, csosn: i.csosn };
      if (["102", "103", "300", "400"].includes(i.csosn)) return { icmssn102: base };
      if (i.csosn === "101") {
        return { icmssn101: { ...base, p_cred_sn: 0, v_cred_icmssn: 0 } };
      }
      if (i.csosn === "500") {
        return { icmssn500: { ...base, v_bcst_ret: 0, v_icmsst_ret: 0 } };
      }
      throw new FiscalProviderError(
        `CSOSN ${i.csosn} (item ${i.ordem}) ainda não é suportado na emissão. Ajuste o perfil fiscal do produto.`,
      );
    }

    const cst = i.cst ?? "00";
    const base = { orig, cst };
    if (cst === "00") {
      const aliquota = i.aliquotaIcms ?? 0;
      const vBC = i.valorTotal - i.valorDesconto;
      return {
        icms00: {
          ...base,
          mod_bc: 3, // valor da operação
          v_bc: round2(vBC),
          p_icms: aliquota,
          v_icms: round2((vBC * aliquota) / 100),
        },
      };
    }
    if (["40", "41", "50"].includes(cst)) return { icms40: base };
    if (cst === "60") return { icms60: base };
    throw new FiscalProviderError(
      `CST ${cst} (item ${i.ordem}) ainda não é suportado na emissão. Ajuste o perfil fiscal do produto.`,
    );
  }

  const round2 = (v: number) => Math.round(v * 100) / 100;

  function det(i: ItemFiscal) {
    const qTrib = i.quantidadeTributavel ?? i.quantidade;
    return {
      n_item: i.ordem,
      prod: {
        c_prod: i.codigo,
        // "SEM GTIN" é o literal que a SEFAZ espera — string vazia é rejeição.
        c_ean: i.gtin || "SEM GTIN",
        x_prod: i.descricao,
        ncm: i.ncm,
        ...(i.cest ? { cest: i.cest } : {}),
        ...(i.codigoBeneficio ? { c_benef: i.codigoBeneficio } : {}),
        cfop: i.cfop,
        u_com: i.unidade,
        q_com: i.quantidade,
        v_un_com: i.valorUnitario,
        v_prod: round2(i.valorTotal),
        c_ean_trib: i.gtin || "SEM GTIN",
        u_trib: i.unidadeTributavel ?? i.unidade,
        q_trib: qTrib,
        v_un_trib: qTrib > 0 ? round2(i.valorTotal / qTrib) : i.valorUnitario,
        ...(i.valorDesconto > 0 ? { v_desc: round2(i.valorDesconto) } : {}),
        ind_tot: 1,
      },
      imposto: {
        icms: icmsDoItem(i),
        // Simples Nacional não destaca PIS/COFINS; CST 07 (alíquota zero)
        // mantém o grupo presente, que o schema exige.
        pis: { pisaliq: { cst: "07", v_bc: 0, p_pis: 0, v_pis: 0 } },
        cofins: { cofinsaliq: { cst: "07", v_bc: 0, p_cofins: 0, v_cofins: 0 } },
      },
    };
  }

  function dest(d: DestinatarioFiscal | null) {
    if (!d?.documento) return undefined;
    const doc = d.documento.replace(/\D/g, "");
    return {
      ...(doc.length === 14 ? { cnpj: doc } : { cpf: doc }),
      ...(d.nome ? { x_nome: d.nome } : {}),
      ind_ie_dest: d.indicadorIE ?? 9,
      ...(d.ie ? { ie: d.ie } : {}),
      ...(d.email ? { email: d.email } : {}),
      ...(d.endereco
        ? {
            ender_dest: {
              x_lgr: d.endereco.logradouro,
              nro: d.endereco.numero,
              ...(d.endereco.complemento ? { x_cpl: d.endereco.complemento } : {}),
              x_bairro: d.endereco.bairro,
              c_mun: d.endereco.codigoMunicipio,
              x_mun: d.endereco.municipio,
              uf: d.endereco.uf,
              cep: d.endereco.cep,
            },
          }
        : {}),
    };
  }

  function corpoEmissao(doc: DocumentoParaEmitir) {
    const e = doc.emitente;
    const nfce = doc.modelo === "NFCE";
    const totalItens = doc.itens.reduce((s, i) => s + i.valorTotal, 0);
    const icmsTotal = doc.itens.reduce((s, i) => {
      if (i.csosn || i.cst !== "00") return s;
      return s + ((i.valorTotal - i.valorDesconto) * (i.aliquotaIcms ?? 0)) / 100;
    }, 0);
    const baseIcms = doc.itens.reduce(
      (s, i) => (i.csosn || i.cst !== "00" ? s : s + i.valorTotal - i.valorDesconto),
      0,
    );

    return {
      ambiente,
      // Idempotência de verdade: retry de rede não vira nota duplicada.
      referencia: doc.idempotencyKey,
      inf_nfe: {
        versao: "4.00",
        ide: {
          c_uf: Number(e.codigoMunicipio.slice(0, 2)),
          nat_op: doc.naturezaOperacao,
          mod: nfce ? 65 : 55,
          serie: doc.serie,
          n_nf: doc.numero,
          dh_emi: iso8601Br(doc.dataEmissao),
          tp_nf: 1, // saída
          id_dest: 1, // operação interna
          c_mun_fg: e.codigoMunicipio,
          tp_imp: nfce ? 4 : 1,
          // Contingência offline da NFC-e é tp_emis 9 e exige data + motivo.
          tp_emis: doc.contingencia ? 9 : 1,
          tp_amb: ambiente === "producao" ? 1 : 2,
          fin_nfe: 1,
          ind_final: 1,
          ind_pres: 1, // presencial — é o balcão
          proc_emi: 0,
          ver_proc: VERSAO_APP,
          ...(doc.contingencia
            ? {
                dh_cont: iso8601Br(doc.dataEmissao),
                x_just: "Emissao em contingencia: SEFAZ indisponivel no momento da venda.",
              }
            : {}),
        },
        emit: {
          cnpj: e.cnpj,
          x_nome: e.razaoSocial,
          ...(e.nomeFantasia ? { x_fant: e.nomeFantasia } : {}),
          ie: e.ie,
          ...(e.im ? { im: e.im } : {}),
          crt: e.crt,
          ender_emit: {
            x_lgr: e.logradouro,
            nro: e.numero,
            ...(e.complemento ? { x_cpl: e.complemento } : {}),
            x_bairro: e.bairro,
            c_mun: e.codigoMunicipio,
            x_mun: e.municipio,
            uf: e.uf,
            cep: e.cep,
            ...(e.telefone ? { fone: e.telefone } : {}),
          },
        },
        ...(dest(doc.destinatario) ? { dest: dest(doc.destinatario) } : {}),
        det: doc.itens.map(det),
        total: {
          icms_tot: {
            v_bc: round2(baseIcms),
            v_icms: round2(icmsTotal),
            v_icms_deson: 0,
            v_fcp: 0,
            v_bcst: 0,
            v_st: 0,
            v_fcpst: 0,
            v_fcpst_ret: 0,
            v_prod: round2(totalItens),
            v_frete: 0,
            v_seg: 0,
            v_desc: round2(doc.valorDesconto),
            v_ii: 0,
            v_ipi: 0,
            v_ipi_devol: 0,
            v_pis: 0,
            v_cofins: 0,
            v_outro: 0,
            v_nf: round2(doc.valorTotal),
          },
        },
        transp: { mod_frete: 9 }, // sem transporte
        pag: {
          det_pag: doc.pagamentos.map((p) => ({
            t_pag: TPAG[p.forma],
            v_pag: round2(p.valor),
            ...(p.cartao ? grupoCartao(p.cartao) : {}),
          })),
          ...(() => {
            const troco = doc.pagamentos.reduce((s, p) => s + (p.troco ?? 0), 0);
            return troco > 0 ? { v_troco: round2(troco) } : {};
          })(),
        },
        ...(doc.informacoesComplementares
          ? { inf_adic: { inf_cpl: doc.informacoesComplementares } }
          : {}),
      },
    };
  }

  // ── Normalização das respostas ───────────────────────────

  type EventoResp = {
    id?: string;
    codigo_status?: number;
    motivo_status?: string;
    numero_protocolo?: string;
    data_recebimento?: string;
    data_evento?: string;
    status?: string;
  };

  type Dfe = {
    id?: string;
    status?: string;
    chave?: string;
    autorizacao?: EventoResp;
  };

  const STATUS: Record<string, StatusFiscal> = {
    pendente: "PROCESSANDO",
    processando: "PROCESSANDO",
    autorizado: "AUTORIZADO",
    encerrado: "AUTORIZADO",
    rejeitado: "REJEITADO",
    denegado: "DENEGADO",
    cancelado: "CANCELADO",
    erro: "REJEITADO",
  };

  function normalizar(d: Dfe, contingencia = false): ResultadoFiscal {
    const status = STATUS[d.status ?? ""] ?? "PROCESSANDO";
    const a = d.autorizacao;
    return {
      // Contingência é estado nosso, não deles: a nota saiu offline e continua
      // valendo enquanto a transmissão não fecha.
      status: contingencia && status === "PROCESSANDO" ? "CONTINGENCIA" : status,
      externalId: d.id ?? null,
      chave: d.chave ?? null,
      protocolo: a?.numero_protocolo ?? null,
      dataAutorizacao: dt(a?.data_recebimento),
      codigo: a?.codigo_status == null ? null : String(a.codigo_status),
      mensagem: a?.motivo_status ?? null,
      // A Nuvem Fiscal não devolve o QR da NFC-e no JSON — ele vem impresso no
      // DANFCE que baixamos do próprio provedor.
      qrCodeUrl: null,
      urlConsulta: null,
      payload: d,
    };
  }

  const EVENTO_ACEITO = new Set([135, 136, 155]);

  function normalizarEvento(a: EventoResp | undefined): ResultadoEvento {
    const codigo = a?.codigo_status;
    return {
      aceito: codigo != null ? EVENTO_ACEITO.has(codigo) : a?.status === "registrado",
      protocolo: a?.numero_protocolo ?? null,
      codigo: codigo == null ? null : String(codigo),
      mensagem: a?.motivo_status ?? null,
      dataEvento: dt(a?.data_evento) ?? dt(a?.data_recebimento),
      payload: a,
    };
  }

  function certificado(c: {
    id?: string;
    subject_name?: string;
    nome_razao_social?: string;
    cpf_cnpj?: string;
    not_valid_after?: string;
  }): CertificadoInfo {
    return {
      id: c.id ?? "",
      titular: c.nome_razao_social ?? c.subject_name ?? "—",
      cnpj: (c.cpf_cnpj ?? "").replace(/\D/g, ""),
      validade: dt(c.not_valid_after) ?? new Date(0),
    };
  }

  const arquivo = (
    r: { conteudo: Uint8Array; contentType: string },
    nome: string,
  ): ArquivoFiscal => ({ ...r, nomeSugerido: nome });

  return {
    slug: "NUVEM_FISCAL",

    async validarCredenciais() {
      await req("GET", "/empresas?$top=1");
    },

    /**
     * A empresa precisa existir lá antes do certificado e da primeira nota.
     * PUT é upsert por CNPJ — chamar de novo depois de editar o cadastro é o
     * comportamento desejado.
     */
    async sincronizarEmpresa({ emitente: e, email }) {
      await req("PUT", `/empresas/${e.cnpj}`, {
        body: {
          cpf_cnpj: e.cnpj,
          nome_razao_social: e.razaoSocial,
          ...(e.nomeFantasia ? { nome_fantasia: e.nomeFantasia } : {}),
          inscricao_estadual: e.ie,
          ...(e.im ? { inscricao_municipal: e.im } : {}),
          ...(e.telefone ? { fone: e.telefone } : {}),
          email,
          endereco: {
            logradouro: e.logradouro,
            numero: e.numero,
            ...(e.complemento ? { complemento: e.complemento } : {}),
            bairro: e.bairro,
            codigo_municipio: e.codigoMunicipio,
            cidade: e.municipio,
            uf: e.uf,
            cep: e.cep,
          },
        },
      });
    },

    async enviarCertificado({ cnpj, arquivo: pfx, senha }) {
      const c = await req<Parameters<typeof certificado>[0]>(
        "PUT",
        `/empresas/${cnpj}/certificado`,
        { body: { certificado: Buffer.from(pfx).toString("base64"), password: senha } },
      );
      return certificado(c);
    },

    async validarCertificado(cnpj) {
      const c = await req<Parameters<typeof certificado>[0]>(
        "GET",
        `/empresas/${cnpj}/certificado`,
      );
      return certificado(c);
    },

    async emitirNFCe(doc) {
      const d = await req<Dfe>("POST", "/nfce", { body: corpoEmissao(doc) });
      return normalizar(d, doc.contingencia);
    },

    async emitirNFe(doc) {
      const d = await req<Dfe>("POST", "/nfe", { body: corpoEmissao(doc) });
      return normalizar(d, doc.contingencia);
    },

    async consultarNota({ externalId, modelo }) {
      const d = await req<Dfe>("GET", `${raiz(modelo)}/${externalId}`);
      return normalizar(d);
    },

    async cancelarNota({ externalId, modelo, justificativa }) {
      const a = await req<EventoResp>(
        "POST",
        `${raiz(modelo)}/${externalId}/cancelamento`,
        { body: { justificativa } },
      );
      return normalizarEvento(a);
    },

    async cartaCorrecao({ externalId, modelo, correcao }) {
      // A sequência do evento é controlada pelo provedor — mandar a nossa
      // criaria divergência quando uma CC-e falha no meio do caminho.
      const a = await req<EventoResp>(
        "POST",
        `${raiz(modelo)}/${externalId}/carta-correcao`,
        { body: { correcao } },
      );
      return normalizarEvento(a);
    },

    async inutilizar({ cnpj, modelo, serie, numeroInicial, numeroFinal, justificativa }) {
      const a = await req<EventoResp>("POST", `${raiz(modelo)}/inutilizacoes`, {
        body: {
          ambiente,
          cnpj,
          ano: new Date().getFullYear(),
          serie,
          numero_inicial: numeroInicial,
          numero_final: numeroFinal,
          justificativa,
        },
      });
      return normalizarEvento(a);
    },

    async manifestar({ cnpj, chave, tipo, justificativa }) {
      const TIPO_EVENTO = {
        CONFIRMACAO: "210200",
        CIENCIA: "210210",
        DESCONHECIMENTO: "210220",
        NAO_REALIZADA: "210240",
      } as const;
      const a = await req<EventoResp>("POST", "/distribuicao/nfe/manifestacoes", {
        body: {
          cpf_cnpj: cnpj,
          ambiente,
          chave_acesso: chave,
          tipo_evento: TIPO_EVENTO[tipo],
          ...(justificativa ? { justificativa } : {}),
        },
      });
      return normalizarEvento(a);
    },

    async baixarXML({ externalId, modelo }) {
      const r = await req<{ conteudo: Uint8Array; contentType: string }>(
        "GET",
        `${raiz(modelo)}/${externalId}/xml`,
        { binario: true },
      );
      return arquivo(r, `${externalId}.xml`);
    },

    async baixarPDF({ externalId, modelo }) {
      const r = await req<{ conteudo: Uint8Array; contentType: string }>(
        "GET",
        `${raiz(modelo)}/${externalId}/pdf`,
        { binario: true },
      );
      return arquivo(r, `${externalId}.pdf`);
    },
  };
}

/**
 * Distribuição DF-e: as notas que fornecedores emitiram CONTRA este CNPJ.
 * Fica fora da interface FiscalProvider porque é um fluxo de entrada, não de
 * emissão — quem consome é o módulo de Notas recebidas.
 */
export type DocumentoDistribuido = {
  externalId: string;
  nsu: number | null;
  chave: string;
  resumo: boolean;
  emitCnpj: string;
  emitRazaoSocial: string;
  valorTotal: number | null;
  dataEmissao: Date | null;
};

export function distribuicaoNuvemFiscal(cfg: {
  apiToken: string | null;
  ambiente: FiscalAmbiente;
}) {
  const ambiente: Ambiente = cfg.ambiente === "PRODUCAO" ? "producao" : "homologacao";

  async function req<T>(metodo: string, caminho: string, body?: unknown): Promise<T> {
    const token = await accessToken(cfg.apiToken);
    let res: Response;
    try {
      res = await fetch(`${API}${caminho}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch (e) {
      throw new FiscalProviderError("Não foi possível falar com a Nuvem Fiscal.", e);
    }
    if (!res.ok) {
      throw new FiscalProviderError(mensagemDeErro(res.status, await res.text().catch(() => "")));
    }
    return (res.status === 204 ? null : await res.json()) as T;
  }

  return {
    /** Dispara uma consulta de distribuição na SEFAZ (puxa o que há de novo). */
    async sincronizar(cnpj: string): Promise<void> {
      await req("POST", "/distribuicao/nfe", { cpf_cnpj: cnpj, ambiente });
    },

    /** Documentos já distribuídos para este CNPJ. */
    async listarDocumentos(cnpj: string, limite = 50): Promise<DocumentoDistribuido[]> {
      const r = await req<{
        data?: {
          id: string;
          nsu?: number;
          chave_acesso?: string;
          resumo?: boolean;
          valor_nfe?: number;
          data_evento?: string;
          created_at?: string;
          emitente_cpf_cnpj?: string;
          emitente_nome_razao_social?: string;
          tipo_documento?: string;
        }[];
      }>(
        "GET",
        `/distribuicao/nfe/documentos?cpf_cnpj=${cnpj}&ambiente=${ambiente}&$top=${limite}`,
      );

      return (r.data ?? [])
        .filter((d) => d.chave_acesso)
        .map((d) => ({
          externalId: d.id,
          nsu: d.nsu ?? null,
          chave: d.chave_acesso as string,
          // Resumo é só o "aviso" da nota: não tem itens, então não vira
          // entrada de estoque sozinho — precisa de manifestação antes.
          resumo: d.resumo ?? true,
          emitCnpj: (d.emitente_cpf_cnpj ?? "").replace(/\D/g, ""),
          emitRazaoSocial: d.emitente_nome_razao_social ?? "—",
          valorTotal: d.valor_nfe ?? null,
          dataEmissao: dt(d.data_evento) ?? dt(d.created_at),
        }));
    },

    /** XML completo de um documento distribuído (só depois de manifestado). */
    async baixarXml(externalId: string): Promise<string> {
      const token = await accessToken(cfg.apiToken);
      const res = await fetch(`${API}/distribuicao/nfe/documentos/${externalId}/xml`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new FiscalProviderError(mensagemDeErro(res.status, await res.text().catch(() => "")));
      }
      return res.text();
    },
  };
}

export type DistribuicaoFiscal = ReturnType<typeof distribuicaoNuvemFiscal>;

// Tipos usados só para checar a forma do que passamos ao provedor.
export type { EmitenteFiscal };
