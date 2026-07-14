import DriverForm from "@/components/driver-form";

export default async function DriverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DriverForm token={token} />;
}
