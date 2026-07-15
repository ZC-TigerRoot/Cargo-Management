import { redirect } from "next/navigation";
import UserManagement from "@/components/user-management";
import { AuthorizationError, requireUser } from "@/lib/auth";

export default async function UsersPage() {
  try {
    await requireUser("manageUsers");
  } catch (error) {
    if (error instanceof AuthorizationError) redirect(error.status === 401 ? "/login" : "/");
    throw error;
  }
  return <UserManagement />;
}
