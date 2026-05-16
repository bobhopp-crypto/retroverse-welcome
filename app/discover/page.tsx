import { redirect } from "next/navigation";

/** Retired — legacy discover entry points straight at canonical RetroScope. */
export default function DiscoverRedirectPage() {
  redirect("/album-retroscope");
}
