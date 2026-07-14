import { NextResponse } from "next/server"; import { vehicles } from "@/lib/demo-data";
export async function GET(){ return NextResponse.json({data:{total:vehicles.length,inStock:vehicles.filter(v=>v.status==='在库').length,pendingPickup:vehicles.filter(v=>v.status==='待提货').length,exceptions:vehicles.filter(v=>v.status==='异常').length}}); }

