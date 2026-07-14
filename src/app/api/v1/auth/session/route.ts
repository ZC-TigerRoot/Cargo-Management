import { NextResponse } from "next/server";
import { requireUser, AuthorizationError } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireUser("view");
    return NextResponse.json({ data: { id: user.id, email: user.email, name: user.name, role: user.roleName } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "UNAUTHENTICATED", message: error.message }, { status: error.status });
    throw error;
  }
}
