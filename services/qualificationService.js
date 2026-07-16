function qualifies(candidate) {
  if (!candidate) return false;

  const visa = String(candidate.visa_status || '').toLowerCase().trim();
  const location = String(candidate.location || '').toLowerCase().trim();
  const marketing = String(candidate.marketing_services || '').toLowerCase().trim();

  const validVisa =
    visa.includes('opt') ||
    visa.includes('stem') ||
    visa.includes('cpt');

  const blockedLocations = [
    'india',
    'pakistan',
    'bangladesh',
    'nepal',
    'sri lanka',
    'remote india'
  ];

  const invalidLocation = blockedLocations.some(loc => location.includes(loc));

  const validMarketing = marketing === 'yes';

  const finalDecision = validVisa && !invalidLocation && validMarketing;

  console.log('----------------------');
  console.log('Candidate Check');
  console.log('Visa:', visa);
  console.log('Location:', location);
  console.log('Marketing:', marketing);
  console.log('Valid Visa:', validVisa);
  console.log('Invalid Location:', invalidLocation);
  console.log('Valid Marketing:', validMarketing);
  console.log('Final Decision:', finalDecision);
  console.log('----------------------');

  return finalDecision;
}

module.exports = qualifies;
