import type { RNG } from '../rng';
import type { Sex } from '../types';

const MALE = [
  'João', 'Pedro', 'Lucas', 'Gabriel', 'Rafael', 'Mateus', 'Gustavo', 'Felipe',
  'Bruno', 'Carlos', 'André', 'Diego', 'Eduardo', 'Fernando', 'Henrique', 'Igor',
  'Leonardo', 'Marcelo', 'Otávio', 'Paulo', 'Ricardo', 'Rodrigo', 'Samuel', 'Thiago',
  'Vinícius', 'Caio', 'Daniel', 'Murilo', 'Renato', 'Sérgio',
];
const FEMALE = [
  'Maria', 'Ana', 'Juliana', 'Camila', 'Fernanda', 'Beatriz', 'Larissa', 'Mariana',
  'Carolina', 'Letícia', 'Amanda', 'Bruna', 'Clara', 'Daniela', 'Elisa', 'Gabriela',
  'Helena', 'Isabela', 'Laura', 'Luiza', 'Natália', 'Patrícia', 'Rafaela', 'Sofia',
  'Tatiana', 'Valentina', 'Vitória', 'Yasmin', 'Cecília', 'Marina',
];
const SURNAMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Rodrigues',
  'Almeida', 'Nascimento', 'Carvalho', 'Araújo', 'Ribeiro', 'Fernandes', 'Gomes',
  'Martins', 'Rocha', 'Barbosa', 'Alves', 'Monteiro', 'Cardoso', 'Teixeira',
  'Moreira', 'Correia', 'Cavalcanti', 'Dias', 'Castro', 'Campos', 'Duarte', 'Freitas',
];

export function randomName(rng: RNG, sex: Sex): string {
  const first = sex === 'M' ? rng.pick(MALE) : rng.pick(FEMALE);
  return `${first} ${rng.pick(SURNAMES)} ${rng.pick(SURNAMES)}`;
}

export function childName(rng: RNG, sex: Sex, fatherName: string): string {
  const first = sex === 'M' ? rng.pick(MALE) : rng.pick(FEMALE);
  const parts = fatherName.split(' ');
  const family = parts[parts.length - 1] ?? rng.pick(SURNAMES);
  return `${first} ${rng.pick(SURNAMES)} ${family}`;
}

const COMPANY_PREFIX = [
  'Nova', 'Alpha', 'Mega', 'Prime', 'Global', 'Delta', 'Vértice', 'Aurora',
  'Horizonte', 'Atlas', 'Solar', 'Urbana', 'Central', 'Real', 'Vital',
];
const COMPANY_SUFFIX: Record<string, string[]> = {
  tecnologia: ['Tech', 'Soft', 'Data', 'Sistemas', 'Digital', 'Labs'],
  comercio: ['Comércio', 'Varejo', 'Mercados', 'Lojas', 'Distribuidora'],
  industria: ['Indústrias', 'Metalúrgica', 'Fábrica', 'Manufatura'],
  servicos: ['Serviços', 'Consultoria', 'Soluções', 'Logística'],
  cultura: ['Estúdio', 'Produções', 'Mídia', 'Criativa'],
  esporte: ['Clube', 'Atlético', 'Esporte Clube', 'Futebol Clube', 'Arena'],
};

export function companyName(rng: RNG, sector: string): string {
  const suffixes = COMPANY_SUFFIX[sector] ?? ['Group'];
  return `${rng.pick(COMPANY_PREFIX)} ${rng.pick(suffixes)}`;
}
