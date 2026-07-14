import { NextRequest, NextResponse } from "next/server";
import { vehicles } from "@/lib/demo-data";
import { vehicleInput } from "@/lib/validators";
export async function GET(req:NextRequest){ const q=(req.nextUrl.searchParams.get('q')||'').toLowerCase(); return NextResponse.json({data:vehicles.filter(v=>!q||`${v.vin}${v.model}${v.referenceNo}${v.customer}`.toLowerCase().includes(q)),meta:{total:vehicles.length}}); }
export async function POST(req:NextRequest){ const parsed=vehicleInput.safeParse(await req.json()); if(!parsed.success) return NextResponse.json({error:"VALIDATION_ERROR",issues:parsed.error.flatten()}, {status:422}); return NextResponse.json({data:{id:crypto.randomUUID(),...parsed.data,status:"待入库",version:1},audit:{action:"VEHICLE_CREATED"}}, {status:201}); }

