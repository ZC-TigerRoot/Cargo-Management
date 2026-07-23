import { redirect } from "next/navigation";
import ModulePage from "@/components/module-page";
import { AuthorizationError, requireUser } from "@/lib/auth";

export default async function SettingsPage() {
  try {
    await requireUser("manageSettings");
  } catch (error) {
    if (error instanceof AuthorizationError) redirect(error.status === 401 ? "/login" : "/");
    throw error;
  }
  return <ModulePage kind="settings" />;
}
