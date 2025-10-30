import {
  Link,
  Image,
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Navbar as HeroUINavbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
} from "@heroui/react";
import {
  X,
  Discord,
  GithubCircle,
  Telegram,
  NavArrowDown,
  Xmark,
} from "iconoir-react";
import { useLocation } from "react-router-dom";
import { useState } from "react";

import { siteConfig } from "@/config/site";

// const debug = d("app:nav");

export const Navbar = () => {
  const { pathname } = useLocation();
  const isUSDC = pathname === "/";
  const isBTC = pathname === "/stake";
  const currentPage = isUSDC ? "Buy" : "Stake";
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    { name: "Buy", href: "/" },
    { name: "Stake", href: "/stake" },
  ];

  return (
    <HeroUINavbar maxWidth="xl" position="static">
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand>
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
        </NavbarBrand>
      </NavbarContent>

      <NavbarContent className="basis-1/5" justify="center">
        {/* Mobile dropdown selector */}
        <NavbarItem className="sm:hidden">
          <Dropdown
            isOpen={isOpen}
            placement="bottom-start"
            onOpenChange={setIsOpen}
          >
            <DropdownTrigger>
              <Button
                endContent={isOpen ? <Xmark /> : <NavArrowDown />}
                size="lg"
                variant="light"
              >
                {currentPage}
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label="Navigation menu">
              {menuItems.map((item) => (
                <DropdownItem key={item.name} as={Link} href={item.href}>
                  {item.name}
                </DropdownItem>
              ))}
            </DropdownMenu>
          </Dropdown>
        </NavbarItem>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex basis-1/5" justify="center">
        <NavbarItem>
          <Button
            as={Link}
            className="min-w-16"
            color={isUSDC ? "primary" : "default"}
            href="/"
            size="sm"
            variant={isUSDC ? "solid" : "light"}
          >
            Buy
          </Button>
        </NavbarItem>
        <NavbarItem>
          <Button
            as={Link}
            className="min-w-16"
            color={isBTC ? "primary" : "default"}
            href="/stake"
            size="sm"
            variant={isBTC ? "solid" : "light"}
          >
            Stake
          </Button>
        </NavbarItem>
      </NavbarContent>

      <NavbarContent className="flex basis-1/5" justify="end">
        <NavbarItem>
          <Link isExternal href={siteConfig.links.twitter} title="Twitter">
            <X className="text-default-500" />
          </Link>
        </NavbarItem>
        <NavbarItem>
          <Link isExternal href={siteConfig.links.telegram} title="Telegram">
            <Telegram className="text-default-500" />
          </Link>
        </NavbarItem>
        <NavbarItem>
          <Link isExternal href={siteConfig.links.discord} title="Discord">
            <Discord className="text-default-500" />
          </Link>
        </NavbarItem>
        <NavbarItem>
          <Link isExternal href={siteConfig.links.github} title="GitHub">
            <GithubCircle className="text-default-500" />
          </Link>
        </NavbarItem>
      </NavbarContent>
    </HeroUINavbar>
  );
};
