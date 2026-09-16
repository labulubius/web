export type Site = {
  name: string;
  description: string;
  url: string;
  category: string;
  initials: string;
  accent: string;
  featured?: boolean;
};

export const sites: Site[] = [
  {
    name: "Python",
    description: "The official home of the Python programming language.",
    url: "https://www.python.org/",
    category: "Programming Languages",
    initials: "Py",
    accent: "linear-gradient(135deg, #3776ab, #ffd343)",
  },
  {
    name: "NGINX",
    description: "The official site for the NGINX web server and reverse proxy.",
    url: "https://nginx.org/",
    category: "Web Infrastructure",
    initials: "N",
    accent: "linear-gradient(135deg, #009639, #006b2a)",
  },
  {
    name: "HTML",
    description: "The official HTML Living Standard maintained by WHATWG.",
    url: "https://html.spec.whatwg.org/",
    category: "Web Standards",
    initials: "H5",
    accent: "linear-gradient(135deg, #e44d26, #f16529)",
  },
];
