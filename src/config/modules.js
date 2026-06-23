const DOCTORS = {
  optometria: [
    'Nuevo',
    'Controles',
    'Glaucoma',
    'Retina',
    'Córnea',
    'Catarata',
    'Cirugía Refractiva'
  ],
  examenes: [
    'Dra. Patricia Vega',
    'Dr. Jorge Cárdenas',
    'Dra. Fiorella Núñez',
    'Dr. César León',
    'Dra. Rosa Aguilar',
    'Dr. Henry Valdez',
    'Dra. Lucía Soto',
    'Dr. Wilber Flores',
    'Dra. Maritza Salas',
    'Dr. Bruno Yucra'
  ],
  consultorio: [
    'MÉDICO 1',
    'MÉDICO 2',
    'MÉDICO 3',
    'MÉDICO 4',
    'MÉDICO 5',
    'MÉDICO 6',
    'MÉDICO 7'
  ],
  imagenes: [
    'Dra. Katherine Ramos',
    'Dr. Julio Benavente',
    'Dra. Xiomara Aliaga',
    'Dr. Miguel Choquepuma',
    'Dra. Verónica Paredes',
    'Dr. César Ccorimanya',
    'Dra. Pamela Quisbert',
    'Dr. Javier Luna',
    'Dra. Claudia Tapia',
    'Dr. Frank Pinto'
  ],
  ipl: [
    'IPL General'
  ],
  cirugia: [
    'Cirugía General',
    'Cirugía Refractiva',
    'Cirugía Catarata',
    'Cirugía Retina'
  ]
};

const MODULES = {
  optometria: { id: 'optometria', label: 'Optometría', prefix: 'OPT', room: 'Optometría', doctors: DOCTORS.optometria },
  examenes: { id: 'examenes', label: 'Exámenes', prefix: 'EXA', room: 'Exámenes', doctors: DOCTORS.examenes, hiddenFromClient: true },
  consultorio: { id: 'consultorio', label: 'Consultorio', prefix: 'CON', room: 'Consultorio', doctors: DOCTORS.consultorio },
  imagenes: { id: 'imagenes', label: 'Imágenes', prefix: 'IMG', room: 'Imágenes', doctors: DOCTORS.imagenes, hiddenFromClient: true },
  ipl: { id: 'ipl', label: 'IPL', prefix: 'IPL', room: 'IPL', doctors: DOCTORS.ipl },
  cirugia: { id: 'cirugia', label: 'Cirugía', prefix: 'CIR', room: 'Cirugía', doctors: DOCTORS.cirugia }
};

function normalizeModule(moduleId) {
  const raw = String(moduleId || '').trim().toLowerCase();
  const normalized = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const aliases = {
    '1': 'optometria',
    optometria: 'optometria',
    optometria1: 'optometria',
    '2': 'examenes',
    examen: 'examenes',
    examenes: 'examenes',
    examenes1: 'examenes',
    '3': 'consultorio',
    consultorio: 'consultorio',
    consultorios: 'consultorio',
    consultorio1: 'consultorio',
    '4': 'imagenes',
    imagen: 'imagenes',
    imagenes: 'imagenes',
    imagenologia: 'imagenes',
    imagenologia1: 'imagenes',
    imagenes1: 'imagenes',
    '5': 'ipl',
    ipl: 'ipl',
    ipl1: 'ipl',
    '6': 'cirugia',
    cirugia: 'cirugia',
    cirugias: 'cirugia',
    cirugia1: 'cirugia'
  };

  return MODULES[aliases[normalized]] ? aliases[normalized] : 'consultorio';
}

function getModuleMeta(moduleId) {
  const normalized = normalizeModule(moduleId);
  const module = MODULES[normalized];
  return { ...module, doctors: [...module.doctors] };
}

function getDefaultDoctor(moduleId, index = 0) {
  const doctors = getModuleMeta(moduleId).doctors;
  return doctors[index] || doctors[0] || 'Médico asignado';
}

module.exports = { MODULES, DOCTORS, normalizeModule, getModuleMeta, getDefaultDoctor };
