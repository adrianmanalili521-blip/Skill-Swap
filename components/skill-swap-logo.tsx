import Image from "next/image";
import skillSwapLogo from "../assets/logo_skill_swap.png";

export function SkillSwapLogo() {
  return <Image className="skill-swap-logo" src={skillSwapLogo} alt="Skill Swap" />;
}
