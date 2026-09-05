import { CheckCircle2Icon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/navigation";

const ALERTS = [
  { variant: "default", icon: InfoIcon },
  { variant: "info", icon: InfoIcon },
  { variant: "success", icon: CheckCircle2Icon },
  { variant: "warning", icon: TriangleAlertIcon },
  { variant: "destructive", icon: OctagonXIcon },
] as const;

/** Alerts, progress, separator, breadcrumb, tabs, pagination and a card (AC-6). Server. */
export function FeedbackSection() {
  const t = useTranslations("gallery.feedback");
  return (
    <div className="flex flex-col gap-12">
      <Example label={t("alerts")}>
        <div className="flex w-full max-w-2xl flex-col gap-3">
          {ALERTS.map(({ variant, icon: Icon }) => (
            <Alert key={variant} variant={variant}>
              <Icon aria-hidden="true" />
              <AlertTitle>{t(`alert.${variant}.title`)}</AlertTitle>
              <AlertDescription>{t(`alert.${variant}.description`)}</AlertDescription>
            </Alert>
          ))}
        </div>
      </Example>

      <Example label={t("card")}>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t("cardTitle")}</CardTitle>
            <CardDescription>{t("cardDescription")}</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm">
                {t("cardAction")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="font-semibold text-2xl tabular-nums" data-numeric>
              74 %
            </p>
            <Progress value={74} aria-label={t("progressLabel")} />
          </CardContent>
          <CardFooter className="text-muted-foreground text-xs">{t("cardFooter")}</CardFooter>
        </Card>
      </Example>

      <Example label={t("separator")}>
        <div className="flex h-6 items-center gap-3 text-sm">
          <span>{t("separatorA")}</span>
          <Separator orientation="vertical" />
          <span>{t("separatorB")}</span>
        </div>
      </Example>

      <Example label={t("breadcrumb")}>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/admin">{t("crumbs.root")}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/admin">{t("crumbs.companies")}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t("crumbs.current")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Example>

      <Example label={t("tabs")}>
        <Tabs defaultValue="overview" className="w-full max-w-md">
          <TabsList>
            <TabsTrigger value="overview">{t("tab.overview")}</TabsTrigger>
            <TabsTrigger value="findings">{t("tab.findings")}</TabsTrigger>
            <TabsTrigger value="history">{t("tab.history")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-muted-foreground text-sm">
            {t("tabBody.overview")}
          </TabsContent>
          <TabsContent value="findings" className="text-muted-foreground text-sm">
            {t("tabBody.findings")}
          </TabsContent>
          <TabsContent value="history" className="text-muted-foreground text-sm">
            {t("tabBody.history")}
          </TabsContent>
        </Tabs>
      </Example>

      <Example label={t("pagination")}>
        <Pagination className="mx-0 w-auto justify-start">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#pagination" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#pagination" isActive>
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#pagination">2</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#pagination" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </Example>
    </div>
  );
}
