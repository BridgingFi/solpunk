import { Link } from "@heroui/link";
import { Image } from "@heroui/image";
import {
  Navbar as HeroUINavbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
} from "@heroui/navbar";
import { X, Discord, GithubCircle, Telegram } from "iconoir-react";

import { siteConfig } from "@/config/site";

// const debug = d("app:nav");

export const Navbar = () => {
  return (
    <HeroUINavbar maxWidth="xl" position="static">
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand className="gap-3 max-w-fit">
          <Link className="items-baseline gap-1" href="/">
            <Image
              alt="Logo"
              className="h-5 w-11"
              radius="none"
              src="/logo.svg"
            />
            <Image
              alt="BridgingFi"
              className="h-4 w-24"
              radius="none"
              src="/brand_dark.svg"
            />
          </Link>
        </NavbarBrand>
      </NavbarContent>

      <NavbarContent className="flex basis-1/5" justify="end">
        <NavbarItem className="flex gap-2">
          <Link isExternal href={siteConfig.links.twitter} title="Twitter">
            <X className="text-default-500" />
          </Link>
          <Link isExternal href={siteConfig.links.telegram} title="Telegram">
            <Telegram className="text-default-500" />
          </Link>
          <Link isExternal href={siteConfig.links.discord} title="Discord">
            <Discord className="text-default-500" />
          </Link>
          <Link isExternal href={siteConfig.links.github} title="GitHub">
            <GithubCircle className="text-default-500" />
          </Link>
        </NavbarItem>
      </NavbarContent>
    </HeroUINavbar>
  );
};
