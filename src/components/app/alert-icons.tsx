import {
  PackageX, AlertTriangle, Tag, PackagePlus, ShoppingCart,
  ArrowLeftRight, Truck, ClipboardList, Sparkles, PauseCircle, Coins, Percent,
  Wine, TrendingUp, TrendingDown, Flame, Cake, Gift, CalendarClock,
  MailWarning, FileSignature, FileClock, Wallet, type LucideIcon,
} from "lucide-react";
import type { AlertIcon } from "@/lib/alerts-types";

/**
 * Ícone de cada tipo de alerta. Vive fora do sino porque o feed mobile
 * (`/m/alertas`) mostra a mesma lista: dois mapas seriam duas chances de o
 * mesmo alerta aparecer com cara diferente em cada tela.
 *
 * Guarda o COMPONENTE, não o elemento pronto — cada superfície escolhe o
 * tamanho (16px no sino do desktop, 18px no cartão do celular).
 */
export const ALERT_ICON: Record<AlertIcon, LucideIcon> = {
  "sem-estoque": PackageX,
  minimo: AlertTriangle,
  "sem-preco": Tag,
  reposicao: PackagePlus,
  compra: ShoppingCart,
  transferencia: ArrowLeftRight,
  recebimento: Truck,
  inventario: ClipboardList,
  divergencia: AlertTriangle,
  novo: Sparkles,
  parado: PauseCircle,
  custo: Coins,
  margem: Percent,
  consumo: Wine,
  alta: TrendingUp,
  baixa: TrendingDown,
  campeao: Flame,
  aniversario: Cake,
  "cliente-risco": Gift,
  validade: CalendarClock,
  "canal-nfe": MailWarning,
  certificado: FileSignature,
  "documento-pendente": FileClock,
  "saldo-pendente": PackageX,
  "titulo-vencido": Wallet,
};
