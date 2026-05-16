import { redirect } from "next/navigation";

/** Retired — legacy viewer entry points straight at canonical RetroScope. */
export default function ViewerRedirectPage() {
  redirect("/album-retroscope");
}
